import { randomBytes } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A cookie jar standing in for the browser's.
 *
 * `startSession` reaches for `next/headers`, which only exists inside a
 * request. Mocking it is what lets the rest of this file run against the real
 * database and assert the thing that actually matters: that a session is a row
 * in `Session`, and that the cookie carries that row's token.
 */
interface StoredCookie {
  value: string;
  options: Record<string, unknown>;
}

const jar = new Map<string, StoredCookie>();

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => {
        const found = jar.get(name);
        return found ? { name, value: found.value } : undefined;
      },
      set: (name: string, value: string, options: Record<string, unknown> = {}) => {
        jar.set(name, { value, options });
      },
      delete: (name: string) => {
        jar.delete(name);
      },
    }),
}));

const { createAccountFromInvitation, hasPassword, setPassword, signInWithPassword } =
  await import("~/lib/auth/accounts");
const { hashPassword, verifyPassword } = await import("~/lib/auth/passwords");
const { endSession, sessionCookieName } = await import("~/lib/auth/sessions");
const { inviteMember } = await import("~/lib/db/scoped/member-writes");
const { withUntenantedTx } = await import("~/lib/db/tx");
const { ADELAIDE, LISPENARD, PEOPLE, contextFor } = await import("../helpers/context");

type BuildingContext = Awaited<ReturnType<typeof contextFor>>;

/**
 * Signing in with a password, and making an account with one.
 *
 * Written from the attacker's side, because that is where the interesting cases
 * are: guessing at the form, learning who lives here by timing the answers,
 * inviting an address that already belongs to somebody in another building and
 * setting a password on it. Each of those is a way into a building's records,
 * and none of them is caught by testing that a correct password works.
 */

const GOOD = "cornice-parapet-transom-41";
const OTHER = "areaway-shutter-brickwork-9";

/** A fresh address per run, so re-running does not hit "already a member". */
function freshEmail(prefix: string): string {
  return `${prefix}.${randomBytes(4).toString("hex")}@example.com`;
}

function tokenFrom(url: string): string {
  return url.split("/invite/")[1] ?? "";
}

async function makeUser(
  email: string,
  password: string | null,
): Promise<{ id: string; email: string }> {
  return withUntenantedTx(async (tx) =>
    tx.user.create({
      data: {
        email,
        name: email.split("@")[0] ?? email,
        ...(password
          ? { passwordHash: await hashPassword(password), passwordSetAt: new Date() }
          : {}),
      },
      select: { id: true, email: true },
    }),
  );
}

function readUser(id: string) {
  return withUntenantedTx((tx) =>
    tx.user.findUnique({
      where: { id },
      select: {
        passwordHash: true,
        signInFailures: true,
        signInBlockedTill: true,
        name: true,
      },
    }),
  );
}

function sessionsFor(userId: string) {
  return withUntenantedTx((tx) =>
    tx.session.findMany({ where: { userId }, select: { sessionToken: true } }),
  );
}

describe("password sign-in", () => {
  let president: BuildingContext;
  let otherPresident: BuildingContext;

  beforeAll(async () => {
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    otherPresident = await contextFor(PEOPLE.ivanPresident, LISPENARD);
  });

  beforeEach(() => {
    jar.clear();
  });

  describe("proving who you are", () => {
    it("signs in, and the cookie carries a session that exists", async () => {
      const user = await makeUser(freshEmail("signs-in"), GOOD);

      const result = await signInWithPassword(user.email, GOOD);
      expect(result.ok).toBe(true);

      const cookie = jar.get(sessionCookieName("http://localhost:3000"));
      const sessions = await sessionsFor(user.id);
      expect(sessions.map((row) => row.sessionToken)).toContain(cookie?.value);
    });

    it("sets a cookie the page cannot read and another site cannot send", async () => {
      // A session token readable from JavaScript is one XSS away from being
      // somebody else's, and one sent on a cross-site request is a form on
      // another page acting as this member.
      const user = await makeUser(freshEmail("cookie-flags"), GOOD);
      await signInWithPassword(user.email, GOOD);

      const cookie = jar.get(sessionCookieName("http://localhost:3000"));
      expect(cookie?.options["httpOnly"]).toBe(true);
      expect(cookie?.options["sameSite"]).toBe("lax");
      expect(cookie?.options["path"]).toEqual("/");
    });

    it("refuses the wrong password without saying it was the password", async () => {
      const user = await makeUser(freshEmail("wrong-password"), GOOD);

      const wrong = await signInWithPassword(user.email, OTHER);
      const unknown = await signInWithPassword(freshEmail("nobody"), OTHER);

      expect(wrong.ok).toBe(false);
      expect(unknown.ok).toBe(false);
      // The same sentence, because "no account with that address" and "wrong
      // password" are two different facts and telling them apart is how a
      // stranger learns who lives here.
      expect(!wrong.ok && wrong.message).toEqual(!unknown.ok && unknown.message);
      expect(jar.size).toEqual(0);
    });

    it("will not let an account with no password be signed into", async () => {
      // Everyone who has only ever used an emailed link. An empty password
      // against a null digest must not compare equal.
      const user = await makeUser(freshEmail("no-password"), null);

      for (const attempt of ["", " ", "null", "undefined"]) {
        expect((await signInWithPassword(user.email, attempt)).ok).toBe(false);
      }
      expect(await sessionsFor(user.id)).toEqual([]);
    });

    it("does not create an account by failing to sign into one", async () => {
      const email = freshEmail("never-existed");
      await signInWithPassword(email, GOOD);

      const user = await withUntenantedTx((tx) =>
        tx.user.findUnique({ where: { email }, select: { id: true } }),
      );
      expect(user).toBeNull();
    });
  });

  describe("guessing at it", () => {
    it("starts costing time after a run of wrong ones", async () => {
      const user = await makeUser(freshEmail("guessed-at"), GOOD);

      // Five are free — a person mistyping is not an attack.
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const result = await signInWithPassword(user.email, OTHER);
        expect(!result.ok && result.code).toEqual("invalid");
      }
      expect((await readUser(user.id))?.signInBlockedTill).toBeNull();

      // The sixth sets a wait.
      await signInWithPassword(user.email, OTHER);
      const blocked = await readUser(user.id);
      expect(blocked?.signInBlockedTill).not.toBeNull();

      const refused = await signInWithPassword(user.email, OTHER);
      expect(!refused.ok && refused.code).toEqual("rate_limited");
      expect(!refused.ok && refused.message).toMatch(/minutes/);
    });

    it("refuses even the right password while the wait is running", async () => {
      // Otherwise the throttle is decorative: a guesser who lands on the right
      // password on attempt fifty is let straight in.
      const user = await makeUser(freshEmail("blocked-but-right"), GOOD);
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await signInWithPassword(user.email, OTHER);
      }

      const result = await signInWithPassword(user.email, GOOD);
      expect(!result.ok && result.code).toEqual("rate_limited");
      expect(await sessionsFor(user.id)).toEqual([]);
    });

    it("never locks the account for good", async () => {
      // A hard lockout is a denial of service anybody can trigger by knowing an
      // address. The wait has to expire on its own.
      const user = await makeUser(freshEmail("waits-out"), GOOD);
      for (let attempt = 0; attempt < 8; attempt += 1) {
        await signInWithPassword(user.email, OTHER);
      }

      const blockedTill = (await readUser(user.id))?.signInBlockedTill;
      expect(blockedTill).toBeInstanceOf(Date);
      expect(blockedTill!.getTime() - Date.now()).toBeLessThanOrEqual(16 * 60_000);

      // Wind the clock forward rather than waiting a quarter of an hour.
      await withUntenantedTx((tx) =>
        tx.user.update({
          where: { id: user.id },
          data: { signInBlockedTill: new Date(Date.now() - 1000) },
        }),
      );
      expect((await signInWithPassword(user.email, GOOD)).ok).toBe(true);
    });

    it("forgets Monday's typos by Friday", async () => {
      const user = await makeUser(freshEmail("forgets"), GOOD);
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await signInWithPassword(user.email, OTHER);
      }
      expect((await readUser(user.id))?.signInFailures).toEqual(4);

      expect((await signInWithPassword(user.email, GOOD)).ok).toBe(true);
      expect((await readUser(user.id))?.signInFailures).toEqual(0);
    });
  });

  describe("making an account from an invitation", () => {
    it("creates the account and the membership in one step", async () => {
      const email = freshEmail("new-neighbour");
      const invited = await inviteMember(president, {
        email,
        roles: ["SHAREHOLDER"],
        unitIds: [],
        note: null,
      });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const created = await createAccountFromInvitation(tokenFrom(invited.data.url), {
        name: "New Neighbour",
        password: GOOD,
      });
      expect(created.ok).toBe(true);
      expect(created.ok && created.data.buildingSlug).toEqual(ADELAIDE);

      // Signed in on the way out — no second trip through the sign-in page.
      const user = await withUntenantedTx((tx) =>
        tx.user.findUnique({ where: { email }, select: { id: true, name: true } }),
      );
      expect(user?.name).toEqual("New Neighbour");
      expect(await sessionsFor(user!.id)).toHaveLength(1);
      expect(jar.get(sessionCookieName("http://localhost:3000"))).toBeDefined();

      // And the password works from the sign-in page afterwards.
      jar.clear();
      expect((await signInWithPassword(email, GOOD)).ok).toBe(true);
    });

    it("will not set a password on an account that already exists", async () => {
      // The takeover this rule exists to stop: a board in one building invites
      // an address that belongs to a member of another, and the token — mailed
      // to that address, held by whoever asked for it — resets their password.
      const email = freshEmail("already-a-member");
      const existing = await makeUser(email, GOOD);
      const before = await readUser(existing.id);

      const invited = await inviteMember(otherPresident, {
        email,
        roles: ["SHAREHOLDER"],
        unitIds: [],
        note: null,
      });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const created = await createAccountFromInvitation(tokenFrom(invited.data.url), {
        name: "Not Them",
        password: OTHER,
      });

      expect(created.ok).toBe(false);
      expect(!created.ok && created.code).toEqual("conflict");

      const after = await readUser(existing.id);
      expect(after?.passwordHash).toEqual(before?.passwordHash);
      expect(after?.name).toEqual(before?.name);
      expect(await verifyPassword(OTHER, after?.passwordHash)).toBe(false);
      expect(await sessionsFor(existing.id)).toEqual([]);
    });

    it("will not adopt an account that has no password either", async () => {
      // The same takeover, one step subtler: an account that has only ever used
      // emailed links has nothing to overwrite, and adopting it would still
      // hand over whatever buildings it already belongs to.
      const email = freshEmail("link-only");
      const existing = await makeUser(email, null);

      const invited = await inviteMember(otherPresident, {
        email,
        roles: ["SHAREHOLDER"],
        unitIds: [],
        note: null,
      });
      if (!invited.ok) throw new Error(invited.message);

      const created = await createAccountFromInvitation(tokenFrom(invited.data.url), {
        name: "Not Them",
        password: OTHER,
      });

      expect(created.ok).toBe(false);
      expect((await readUser(existing.id))?.passwordHash).toBeNull();
    });

    it("leaves nothing behind when the password is refused", async () => {
      const email = freshEmail("too-short");
      const invited = await inviteMember(president, {
        email,
        roles: ["SHAREHOLDER"],
        unitIds: [],
        note: null,
      });
      if (!invited.ok) throw new Error(invited.message);

      const created = await createAccountFromInvitation(tokenFrom(invited.data.url), {
        name: "Too Short",
        password: "short",
      });
      expect(created.ok).toBe(false);

      // No half-made account, and the invitation is still usable.
      const user = await withUntenantedTx((tx) =>
        tx.user.findUnique({ where: { email }, select: { id: true } }),
      );
      expect(user).toBeNull();

      const second = await createAccountFromInvitation(tokenFrom(invited.data.url), {
        name: "Too Short",
        password: GOOD,
      });
      expect(second.ok).toBe(true);
    });

    it("refuses a token that was never minted here", async () => {
      const created = await createAccountFromInvitation(
        randomBytes(32).toString("base64url"),
        { name: "Nobody", password: GOOD },
      );
      expect(created.ok).toBe(false);
    });

    it("insists on a name, because a minute has to say who was there", async () => {
      const email = freshEmail("nameless");
      const invited = await inviteMember(president, {
        email,
        roles: ["SHAREHOLDER"],
        unitIds: [],
        note: null,
      });
      if (!invited.ok) throw new Error(invited.message);

      const created = await createAccountFromInvitation(tokenFrom(invited.data.url), {
        name: "   ",
        password: GOOD,
      });
      expect(created.ok).toBe(false);
    });
  });

  describe("changing it", () => {
    it("asks for the current password before replacing it", async () => {
      // An unattended laptop is how a session ends up in the wrong hands, and a
      // change that does not ask turns five borrowed minutes into a key.
      const user = await makeUser(freshEmail("changes"), GOOD);

      const guessed = await setPassword(user.id, { current: OTHER, password: OTHER });
      expect(!guessed.ok && guessed.code).toEqual("forbidden");
      expect(await verifyPassword(GOOD, (await readUser(user.id))?.passwordHash)).toBe(
        true,
      );

      const changed = await setPassword(user.id, { current: GOOD, password: OTHER });
      expect(changed.ok).toBe(true);
      expect(await verifyPassword(OTHER, (await readUser(user.id))?.passwordHash)).toBe(
        true,
      );
    });

    it("does not ask for one that was never set", async () => {
      const user = await makeUser(freshEmail("first-password"), null);
      expect(await hasPassword(user.id)).toBe(false);

      const set = await setPassword(user.id, { password: GOOD });
      expect(set.ok).toBe(true);
      expect(await hasPassword(user.id)).toBe(true);
    });

    it("signs every other browser out, and leaves this one alone", async () => {
      // The reason to change a password is usually that somebody else might
      // know it. A change that leaves their session alive has fixed nothing.
      //
      // Two sign-ins stand in for two browsers; the second is the one holding
      // the cookie, so it is the one that survives.
      const user = await makeUser(freshEmail("elsewhere"), GOOD);
      await signInWithPassword(user.email, GOOD);
      const elsewhere = jar.get(sessionCookieName("http://localhost:3000"))!.value;
      await signInWithPassword(user.email, GOOD);
      const here = jar.get(sessionCookieName("http://localhost:3000"))!.value;
      expect(here).not.toEqual(elsewhere);

      const changed = await setPassword(user.id, { current: GOOD, password: OTHER });
      expect(changed.ok).toBe(true);

      const remaining = (await sessionsFor(user.id)).map((row) => row.sessionToken);
      expect(remaining).not.toContain(elsewhere);
      // Changing a password must not throw the person who changed it back to
      // the sign-in page — which is exactly what deleting this row would do.
      expect(remaining).toEqual([here]);
    });

    it("refuses a new password that breaks the rules, and keeps the old one", async () => {
      const user = await makeUser(freshEmail("still-short"), GOOD);
      const set = await setPassword(user.id, { current: GOOD, password: "short" });
      expect(!set.ok && set.code).toEqual("invalid");
      expect(await verifyPassword(GOOD, (await readUser(user.id))?.passwordHash)).toBe(
        true,
      );
    });
  });

  describe("signing out", () => {
    it("deletes the session rather than only dropping the cookie", async () => {
      // A cookie cleared in the browser leaves a working token in the database
      // for another month. Whoever captured it still holds a key.
      const user = await makeUser(freshEmail("signs-out"), GOOD);
      await signInWithPassword(user.email, GOOD);
      expect(await sessionsFor(user.id)).toHaveLength(1);

      await endSession();

      expect(await sessionsFor(user.id)).toEqual([]);
      expect(jar.get(sessionCookieName("http://localhost:3000"))).toBeUndefined();
    });
  });

  describe("the cookie's name", () => {
    it("takes the __Secure- prefix only where a browser would accept it", () => {
      // A browser refuses a __Secure- cookie over plain HTTP, so getting this
      // wrong in either direction is a sign-in that appears to work and lands
      // back on the sign-in page.
      expect(sessionCookieName("https://cooperator.example")).toEqual(
        "__Secure-authjs.session-token",
      );
      expect(sessionCookieName("http://localhost:3000")).toEqual(
        "authjs.session-token",
      );
    });
  });
});
