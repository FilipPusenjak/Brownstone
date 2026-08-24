import { withUntenantedTx } from "~/lib/db/tx";
import { fail, ok, type Result } from "~/lib/result";
import { acceptInvitation, lookupInvitation } from "./invitations";
import { hashPassword, passwordProblem, verifyPassword } from "./passwords";
import { endOtherSessions, startSession } from "./sessions";

/**
 * Accounts: creating one, proving you own one, changing the password on one.
 *
 * Three rules shape everything below, and each of them is here because the
 * obvious alternative is a way into somebody else's building.
 *
 * **There is no open sign-up.** A Co-operator account exists to hold a
 * membership, and memberships come from invitations. A public "create an
 * account" form would also be a way to claim an address before the board
 * invites it: register `newowner@gmail.com` today, wait for the invitation, and
 * the binding in `acceptInvitation` — which trusts the address on the account —
 * hands over a stranger's apartment. Holding the invitation token is the proof
 * of address, so the invitation is where the account gets made.
 *
 * **An invitation may create an account and may never touch an existing one.**
 * Not even one with no password set. A board in building B can invite any
 * address it likes; if that address already belongs to somebody in building A,
 * letting the token set a password would let B's president walk into A. The
 * rule is flat and needs no case analysis: a User row that already exists is
 * off limits to a token, full stop.
 *
 * **A wrong password costs time, and never locks the account.** Lockout is a
 * denial of service with a login form in front of it — anybody who knows an
 * address can lock its owner out at will. What is here instead is a delay that
 * grows with consecutive failures and caps, so guessing is impractical and the
 * real owner waits minutes at worst.
 */

/**
 * Consecutive failures allowed before a wait applies, and the wait itself.
 *
 * Five is generous for a typo and miserly for a dictionary. The delay then runs
 * a minute, five, fifteen — capped, so the account is never unusable, only
 * tedious to attack. At the cap a guesser gets four attempts an hour against a
 * scrypt digest, which is not a rate that finds a twelve-character password.
 */
const FREE_ATTEMPTS = 5;
const DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

function delayAfter(failures: number): number {
  // `failures` counts this attempt, so the fifth wrong password is still free
  // and the sixth is the first to cost anything.
  if (failures <= FREE_ATTEMPTS) return 0;
  const step = failures - FREE_ATTEMPTS - 1;
  return DELAYS_MS[Math.min(step, DELAYS_MS.length - 1)]!;
}

/**
 * A digest of a password nobody has, used when the address has no account.
 *
 * Without it, "no such user" returns in a millisecond and "wrong password"
 * takes a tenth of a second, and the difference tells anybody with a stopwatch
 * which addresses are members of this co-op. Verifying against a fixed digest
 * makes both paths cost the same.
 */
const ABSENT_USER_DIGEST =
  "scrypt$65536$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

/** How long until a blocked account may try again, in whole minutes. */
function minutesUntil(when: Date): number {
  return Math.max(1, Math.ceil((when.getTime() - Date.now()) / 60_000));
}

/**
 * Signs in with an email address and a password.
 *
 * One message for every failure. "No account with that address", "you have no
 * password set" and "wrong password" are three different facts, and telling
 * them apart is how a stranger learns who lives here.
 */
export async function signInWithPassword(
  email: string,
  password: string,
): Promise<Result<{ userId: string }>> {
  const address = email.trim().toLowerCase();
  const wrong: Result<{ userId: string }> = fail(
    "invalid",
    "That email address and password don't match an account.",
  );

  if (!address || !password) return wrong;

  const user = await withUntenantedTx((tx) =>
    tx.user.findUnique({
      where: { email: address },
      select: {
        id: true,
        passwordHash: true,
        signInFailures: true,
        signInBlockedTill: true,
      },
    }),
  );

  if (!user) {
    await verifyPassword(password, ABSENT_USER_DIGEST);
    return wrong;
  }

  if (user.signInBlockedTill && user.signInBlockedTill.getTime() > Date.now()) {
    return fail(
      "rate_limited",
      `Too many wrong passwords. Try again in ${minutesUntil(user.signInBlockedTill)} minutes, or use the emailed link instead.`,
    );
  }

  const matched = await verifyPassword(password, user.passwordHash);

  if (!matched) {
    const failures = user.signInFailures + 1;
    const delay = delayAfter(failures);
    await withUntenantedTx((tx) =>
      tx.user.update({
        where: { id: user.id },
        data: {
          signInFailures: failures,
          signInBlockedTill: delay ? new Date(Date.now() + delay) : null,
        },
      }),
    );
    return wrong;
  }

  // A successful sign-in clears the count, so a run of typos on Monday does not
  // still count against somebody on Friday.
  if (user.signInFailures !== 0 || user.signInBlockedTill) {
    await withUntenantedTx((tx) =>
      tx.user.update({
        where: { id: user.id },
        data: { signInFailures: 0, signInBlockedTill: null },
      }),
    );
  }

  await startSession(user.id);
  return ok({ userId: user.id });
}

export interface NewAccount {
  readonly buildingSlug: string;
  readonly buildingName: string;
}

/**
 * Creates an account from an invitation and joins the building, in one step.
 *
 * This is the whole sign-up flow. Someone follows the link the board sent —
 * mailed, or texted to them when the mail bounces — picks a name and a
 * password, and is inside. No second email, no link to wait for.
 *
 * The invitation is re-validated by `acceptInvitation`, which re-runs every
 * check rather than trusting this function's lookup. If the membership cannot
 * be created the account is left in place with its password set, which is the
 * right way round: the person can sign in and see a page telling them their
 * invitation lapsed, rather than losing the password they just chose.
 */
export async function createAccountFromInvitation(
  token: string,
  input: { name: string; password: string },
): Promise<Result<NewAccount>> {
  const lookup = await lookupInvitation(token);
  if (!lookup.ok) return fail("invalid", lookup.reason);

  const email = lookup.invitation.email.toLowerCase();

  const name = input.name.trim();
  if (!name) return fail("invalid", "Enter the name your neighbours would recognise.");
  if (name.length > 120) return fail("invalid", "That name is too long.");

  const problem = passwordProblem(input.password);
  if (problem) return fail("invalid", problem);

  // See the module note: a token may create an account and may never adopt one.
  const existing = await withUntenantedTx((tx) =>
    tx.user.findUnique({ where: { email }, select: { id: true } }),
  );
  if (existing) {
    return fail(
      "conflict",
      `${email} already has a Co-operator account. Sign in with it and follow this link again to join.`,
    );
  }

  const passwordHash = await hashPassword(input.password);

  // Holding the token is proof of the address: it was mailed there and nowhere
  // else, and it is stored only as a hash, so this is the same assurance a
  // confirmation email gives — already collected.
  const user = await withUntenantedTx((tx) =>
    tx.user.create({
      data: {
        email,
        name,
        emailVerified: new Date(),
        passwordHash,
        passwordSetAt: new Date(),
      },
      select: { id: true, email: true },
    }),
  );

  const accepted = await acceptInvitation(token, { id: user.id, email: user.email });
  if (!accepted.ok) return accepted;

  await startSession(user.id);

  return ok({
    buildingSlug: accepted.data.buildingSlug,
    buildingName: accepted.data.buildingName,
  });
}

/**
 * Sets or replaces the signed-in person's password.
 *
 * Replacing one requires the old one. An unattended laptop is the usual way a
 * session ends up in the wrong hands, and a form that changes the password
 * without asking for the current one turns five borrowed minutes into
 * permanent access.
 *
 * Setting a first password does not, because there is nothing to ask for — the
 * session itself came from an emailed link, which is the same proof a reset
 * would demand.
 */
export async function setPassword(
  userId: string,
  input: { current?: string; password: string },
): Promise<Result<null>> {
  const user = await withUntenantedTx((tx) =>
    tx.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
  );
  if (!user) return fail("not_found", "That account no longer exists.");

  if (user.passwordHash) {
    const matched = await verifyPassword(input.current ?? "", user.passwordHash);
    if (!matched) {
      return fail("forbidden", "That isn't your current password.");
    }
  }

  const problem = passwordProblem(input.password);
  if (problem) return fail("invalid", problem);

  const passwordHash = await hashPassword(input.password);

  await withUntenantedTx((tx) =>
    tx.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordSetAt: new Date(),
        signInFailures: 0,
        signInBlockedTill: null,
      },
    }),
  );

  // Every other browser is signed out; this one stays. The reason to change a
  // password is usually that somebody else might know it, and a change that
  // leaves their session alive has fixed nothing.
  await endOtherSessions(userId);

  return ok(null);
}

/** Whether this account can sign in with a password. Powers the account page. */
export async function hasPassword(userId: string): Promise<boolean> {
  const user = await withUntenantedTx((tx) =>
    tx.user.findUnique({ where: { id: userId }, select: { passwordHash: true } }),
  );
  return Boolean(user?.passwordHash);
}
