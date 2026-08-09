import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { CapabilityError } from "~/lib/auth/capabilities";
import {
  acceptInvitation,
  hashToken,
  lookupInvitation,
  mintToken,
} from "~/lib/auth/invitations";
import type { BuildingContext } from "~/lib/db/context";
import { NoSuchBuildingError, resolveBuildingContext } from "~/lib/db/context";
import { inviteMember, revokeInvitation } from "~/lib/db/scoped/member-writes";
import { listInvitations, listMembers, listUnits } from "~/lib/db/scoped/units";
import { withBuildingTx, withUntenantedTx } from "~/lib/db/tx";
import { ADELAIDE, LISPENARD, PEOPLE, contextFor } from "../helpers/context";

/**
 * Invitations, against the real database.
 *
 * This is the way into a building, so the tests are written from the attacker's
 * side: a forwarded link, a guessed token, a revoked invitation clicked anyway,
 * two clicks at once, an invitation for one building used to reach another.
 * Every one of those is a real way people lose control of their records, and
 * none of them is caught by testing the happy path.
 */

/** A fresh address per run, so re-running the suite does not hit "already a member". */
function freshEmail(prefix: string): string {
  return `${prefix}.${randomBytes(4).toString("hex")}@example.com`;
}

/** Stands in for the magic-link sign-in that creates the user row. */
async function signUp(email: string): Promise<{ id: string; email: string }> {
  return withUntenantedTx((tx) =>
    tx.user.create({
      data: { email, name: email.split("@")[0] ?? email },
      select: { id: true, email: true },
    }),
  );
}

function tokenFrom(url: string): string {
  return url.split("/invite/")[1] ?? "";
}

describe("invitations", () => {
  let president: BuildingContext;
  let treasurer: BuildingContext;
  let shareholder: BuildingContext;
  let otherBuilding: BuildingContext;

  beforeAll(async () => {
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    // Has member.invite through the officer set, but not member.manage.
    treasurer = await contextFor(PEOPLE.desmondTreasurer, ADELAIDE);
    shareholder = await contextFor(PEOPLE.halShareholder, ADELAIDE);
    otherBuilding = await contextFor(PEOPLE.ivanPresident, LISPENARD);
  });

  describe("the token", () => {
    it("is not what gets stored", () => {
      const { token, tokenHash } = mintToken();
      expect(tokenHash).not.toEqual(token);
      expect(tokenHash).toEqual(hashToken(token));
      expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it("is long enough that guessing is not a strategy", () => {
      const { token } = mintToken();
      // 32 random bytes, base64url — 256 bits.
      expect(token.length).toBeGreaterThanOrEqual(43);
      expect(mintToken().token).not.toEqual(token);
    });

    it("never appears in the database", async () => {
      const email = freshEmail("stored");
      const invited = await inviteMember(president, {
        email,
        roles: ["SHAREHOLDER"],
      });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const token = tokenFrom(invited.data.url);
      const rows = await withBuildingTx(president.building.id, (tx) =>
        tx.invitation.findMany({ where: { email }, select: { tokenHash: true } }),
      );

      expect(rows).toHaveLength(1);
      expect(rows[0]?.tokenHash).toEqual(hashToken(token));
      expect(rows[0]?.tokenHash).not.toContain(token);
    });
  });

  describe("who may invite", () => {
    it("refuses a plain shareholder", async () => {
      await expect(
        inviteMember(shareholder, {
          email: freshEmail("refused"),
          roles: ["SHAREHOLDER"],
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });

    it("refuses to let an officer without member.manage mint another officer", async () => {
      // The treasurer can invite neighbours all day. Handing out a presidency
      // is a different act, and "invite" must not quietly become "promote".
      await expect(
        inviteMember(treasurer, {
          email: freshEmail("promotion"),
          roles: ["SHAREHOLDER", "PRESIDENT"],
        }),
      ).rejects.toBeInstanceOf(CapabilityError);

      const plain = await inviteMember(treasurer, {
        email: freshEmail("neighbour"),
        roles: ["SHAREHOLDER"],
      });
      expect(plain.ok).toBe(true);
    });

    it("rejects an address that isn't one", async () => {
      const result = await inviteMember(president, {
        email: "not an address",
        roles: ["SHAREHOLDER"],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("invalid");
      expect(result.fields?.["email"]).toBeTruthy();
    });

    it("refuses to invite someone who is already a member", async () => {
      const result = await inviteMember(president, {
        email: PEOPLE.halShareholder,
        roles: ["SHAREHOLDER"],
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("conflict");
    });

    it("writes the email to the notification log before it goes out", async () => {
      const email = freshEmail("logged");
      const invited = await inviteMember(president, {
        email,
        roles: ["SHAREHOLDER"],
      });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const notifications = await withBuildingTx(president.building.id, (tx) =>
        tx.notification.findMany({
          where: { dedupeKey: `invitation:${invited.data.invitationId}` },
          select: { recipientEmail: true, status: true, textBody: true },
        }),
      );

      expect(notifications).toHaveLength(1);
      expect(notifications[0]?.recipientEmail).toEqual(email);
      expect(notifications[0]?.status).toEqual("SENT");
      // The link is in the stored body, which is what the board can point at
      // when someone says they never got it.
      expect(notifications[0]?.textBody).toContain(invited.data.url);
    });

    it("supersedes an outstanding invitation to the same address", async () => {
      const email = freshEmail("resent");

      const first = await inviteMember(president, { email, roles: ["SHAREHOLDER"] });
      const second = await inviteMember(president, { email, roles: ["SHAREHOLDER"] });
      expect(first.ok && second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      const stale = await lookupInvitation(tokenFrom(first.data.url));
      expect(stale.ok).toBe(false);

      const live = await lookupInvitation(tokenFrom(second.data.url));
      expect(live.ok).toBe(true);
    });
  });

  describe("looking one up", () => {
    it("says the same thing for a bad token as for no token", async () => {
      const nonsense = await lookupInvitation(randomBytes(32).toString("base64url"));
      const short = await lookupInvitation("abc");

      expect(nonsense.ok).toBe(false);
      expect(short.ok).toBe(false);
      if (nonsense.ok || short.ok) return;
      // Identical wording: a caller must not be able to tell "no such
      // invitation" from "not a token" and start probing.
      expect(nonsense.reason).toEqual(short.reason);
    });

    it("reveals the building and the invited address, and nothing else", async () => {
      const email = freshEmail("lookup");
      const invited = await inviteMember(president, { email, roles: ["SHAREHOLDER"] });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const lookup = await lookupInvitation(tokenFrom(invited.data.url));
      expect(lookup.ok).toBe(true);
      if (!lookup.ok) return;

      expect(lookup.invitation.email).toEqual(email);
      expect(lookup.invitation.buildingSlug).toEqual(ADELAIDE);
      expect(Object.keys(lookup.invitation).sort()).toEqual([
        "buildingName",
        "buildingSlug",
        "email",
        "expiresAt",
        "id",
        "invitedBy",
        "roles",
      ]);
    });

    it("refuses a revoked invitation", async () => {
      const email = freshEmail("revoked");
      const invited = await inviteMember(president, { email, roles: ["SHAREHOLDER"] });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const revoked = await revokeInvitation(president, invited.data.invitationId);
      expect(revoked.ok).toBe(true);

      const lookup = await lookupInvitation(tokenFrom(invited.data.url));
      expect(lookup.ok).toBe(false);
      if (lookup.ok) return;
      expect(lookup.reason).toContain("withdrawn");
    });

    it("refuses an expired invitation", async () => {
      const email = freshEmail("expired");
      const invited = await inviteMember(president, { email, roles: ["SHAREHOLDER"] });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      await withBuildingTx(president.building.id, (tx) =>
        tx.invitation.update({
          where: { id: invited.data.invitationId },
          data: { expiresAt: new Date(Date.now() - 1000) },
        }),
      );

      const lookup = await lookupInvitation(tokenFrom(invited.data.url));
      expect(lookup.ok).toBe(false);
      if (lookup.ok) return;
      expect(lookup.reason).toContain("expired");
    });
  });

  describe("accepting", () => {
    it("turns an invitation into a membership with the invited unit", async () => {
      const email = freshEmail("joiner");
      const units = await listUnits(president);
      const unit = units[0];
      expect(unit).toBeDefined();
      if (!unit) return;

      const invited = await inviteMember(president, {
        email,
        roles: ["SHAREHOLDER"],
        unitIds: [unit.id],
      });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const user = await signUp(email);

      // Before accepting, the building does not exist as far as they are
      // concerned — holding a token is not membership.
      await expect(resolveBuildingContext(user.id, ADELAIDE)).rejects.toBeInstanceOf(
        NoSuchBuildingError,
      );

      const accepted = await acceptInvitation(tokenFrom(invited.data.url), user);
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) return;
      expect(accepted.data.buildingSlug).toEqual(ADELAIDE);

      const ctx = await resolveBuildingContext(user.id, ADELAIDE);
      expect(ctx.building.slug).toEqual(ADELAIDE);
      expect(ctx.membership.roles).toEqual(["SHAREHOLDER"]);
      expect(ctx.unitIds).toEqual([unit.id]);

      const members = await listMembers(president);
      expect(members.some((member) => member.user.email === email)).toBe(true);
    });

    it("refuses a forwarded link", async () => {
      // The whole reason the invitation is bound to an address: "here's the
      // co-op thing, can you take a look?" must not hand over the building.
      const invitedEmail = freshEmail("intended");
      const strangerEmail = freshEmail("forwarded-to");

      const invited = await inviteMember(president, {
        email: invitedEmail,
        roles: ["SHAREHOLDER"],
      });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const stranger = await signUp(strangerEmail);
      const attempt = await acceptInvitation(tokenFrom(invited.data.url), stranger);

      expect(attempt.ok).toBe(false);
      if (attempt.ok) return;
      expect(attempt.code).toEqual("forbidden");

      await expect(
        resolveBuildingContext(stranger.id, ADELAIDE),
      ).rejects.toBeInstanceOf(NoSuchBuildingError);

      // And the invitation is still usable by the person it was for.
      const rightful = await signUp(invitedEmail);
      const accepted = await acceptInvitation(tokenFrom(invited.data.url), rightful);
      expect(accepted.ok).toBe(true);
    });

    it("matches the address case-insensitively", async () => {
      const email = freshEmail("MixedCase").toLowerCase();
      const invited = await inviteMember(president, {
        email: email.toUpperCase(),
        roles: ["SHAREHOLDER"],
      });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const user = await signUp(email);
      const accepted = await acceptInvitation(tokenFrom(invited.data.url), {
        id: user.id,
        email: email.toUpperCase(),
      });
      expect(accepted.ok).toBe(true);
    });

    it("is single-use", async () => {
      const email = freshEmail("once");
      const invited = await inviteMember(president, { email, roles: ["SHAREHOLDER"] });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const user = await signUp(email);
      const token = tokenFrom(invited.data.url);

      expect((await acceptInvitation(token, user)).ok).toBe(true);

      const again = await acceptInvitation(token, user);
      expect(again.ok).toBe(false);
      if (again.ok) return;
      expect(again.message).toContain("already been used");
    });

    it("survives two clicks at once with one membership", async () => {
      const email = freshEmail("double-click");
      const invited = await inviteMember(president, { email, roles: ["SHAREHOLDER"] });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const user = await signUp(email);
      const token = tokenFrom(invited.data.url);

      const [a, b] = await Promise.all([
        acceptInvitation(token, user),
        acceptInvitation(token, user),
      ]);

      // Exactly one wins. Which one is not interesting; that only one does is.
      expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);

      const memberships = await withBuildingTx(president.building.id, (tx) =>
        tx.membership.count({ where: { userId: user.id } }),
      );
      expect(memberships).toEqual(1);
    });

    it("refuses an invitation revoked after the page was opened", async () => {
      const email = freshEmail("revoked-late");
      const invited = await inviteMember(president, { email, roles: ["SHAREHOLDER"] });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const token = tokenFrom(invited.data.url);
      // The page renders — the invitation is good at this moment.
      expect((await lookupInvitation(token)).ok).toBe(true);

      await revokeInvitation(president, invited.data.invitationId);

      const user = await signUp(email);
      const attempt = await acceptInvitation(token, user);
      expect(attempt.ok).toBe(false);

      await expect(resolveBuildingContext(user.id, ADELAIDE)).rejects.toBeInstanceOf(
        NoSuchBuildingError,
      );
    });

    it("grants only the building it was issued for", async () => {
      const email = freshEmail("one-building");
      const invited = await inviteMember(otherBuilding, {
        email,
        roles: ["SHAREHOLDER"],
      });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const user = await signUp(email);
      const accepted = await acceptInvitation(tokenFrom(invited.data.url), user);
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) return;

      expect(accepted.data.buildingSlug).toEqual(LISPENARD);
      await expect(resolveBuildingContext(user.id, ADELAIDE)).rejects.toBeInstanceOf(
        NoSuchBuildingError,
      );
    });

    it("ignores a unit belonging to another building", async () => {
      // A unit id from Lispenard House posted into an Adelaide invitation. RLS
      // means the row simply is not there, so the link is skipped rather than
      // creating a membership pointing across the tenant boundary.
      const email = freshEmail("stray-unit");
      const strayUnit = (await listUnits(otherBuilding))[0];
      expect(strayUnit).toBeDefined();
      if (!strayUnit) return;

      const invited = await inviteMember(president, {
        email,
        roles: ["SHAREHOLDER"],
        unitIds: [strayUnit.id],
      });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const user = await signUp(email);
      const accepted = await acceptInvitation(tokenFrom(invited.data.url), user);
      expect(accepted.ok).toBe(true);

      const ctx = await resolveBuildingContext(user.id, ADELAIDE);
      expect(ctx.unitIds).toEqual([]);
    });
  });

  describe("withdrawing", () => {
    it("refuses to withdraw one that was already used", async () => {
      const email = freshEmail("spent");
      const invited = await inviteMember(president, { email, roles: ["SHAREHOLDER"] });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const user = await signUp(email);
      expect((await acceptInvitation(tokenFrom(invited.data.url), user)).ok).toBe(true);

      const revoked = await revokeInvitation(president, invited.data.invitationId);
      expect(revoked.ok).toBe(false);
      if (revoked.ok) return;
      expect(revoked.code).toEqual("conflict");
    });

    it("cannot reach an invitation in another building", async () => {
      const invited = await inviteMember(otherBuilding, {
        email: freshEmail("elsewhere"),
        roles: ["SHAREHOLDER"],
      });
      expect(invited.ok).toBe(true);
      if (!invited.ok) return;

      const attempt = await revokeInvitation(president, invited.data.invitationId);
      expect(attempt.ok).toBe(false);
      if (attempt.ok) return;
      expect(attempt.code).toEqual("not_found");
    });
  });

  describe("the list a board reads", () => {
    it("is scoped to the building and hidden from those who cannot invite", async () => {
      const adelaide = await listInvitations(president);
      expect(adelaide.every((row) => row.buildingId === president.building.id)).toBe(
        true,
      );

      await expect(listInvitations(shareholder)).rejects.toBeInstanceOf(
        CapabilityError,
      );
    });
  });
});
