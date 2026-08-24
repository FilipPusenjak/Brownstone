import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { withUntenantedTx } from "~/lib/db/tx";
import { env } from "~/lib/env";

/**
 * Issuing and revoking a session by hand.
 *
 * Auth.js does this for you for every provider it ships — except the one that
 * checks a password. Its `Credentials` provider is documented as requiring the
 * JWT session strategy, and this application deliberately uses database
 * sessions: a membership revoked when somebody sells their apartment has to
 * stop working *now*, not when a token happens to expire. Choosing Credentials
 * would mean trading immediate revocation for a sign-in form, which is the
 * wrong way round.
 *
 * So password sign-in writes the `Session` row itself and sets the same cookie
 * Auth.js would have set. Everything downstream — `auth()`, the adapter,
 * `getSessionAndUser` — is untouched and cannot tell the difference, because
 * there is no difference: it is the same row in the same table read by the same
 * code.
 *
 * The two constants below are Auth.js's, mirrored here. `tests/auth/session.
 * test.ts` pins them, and the browser suite asserts that a session started this
 * way and one started by an emailed link produce the same cookie name — which
 * is the assertion that actually fails if a future version renames it.
 */

/** Auth.js: `30 * 24 * 60 * 60`, sessions expire after 30 days idle. */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

/**
 * Auth.js names the cookie `authjs.session-token`, prefixed `__Secure-` when
 * the deployment is served over HTTPS. The prefix is not decoration: a browser
 * refuses to accept a `__Secure-` cookie over plain HTTP, so getting this wrong
 * in either direction produces a sign-in that appears to work and lands back on
 * the sign-in page.
 */
export function sessionCookieName(authUrl: string = env().AUTH_URL): string {
  const secure = new URL(authUrl).protocol === "https:";
  return secure ? "__Secure-authjs.session-token" : "authjs.session-token";
}

/**
 * Signs a user in: one `Session` row, one cookie.
 *
 * The token is 32 random bytes rather than the UUID Auth.js generates by
 * default. It is a bearer credential sitting in a browser for a month, and
 * there is no reason to hand out less entropy than a cookie can hold.
 */
export async function startSession(userId: string): Promise<void> {
  const sessionToken = randomBytes(32).toString("base64url");
  const expires = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);

  await withUntenantedTx((tx) =>
    tx.session.create({ data: { sessionToken, userId, expires } }),
  );

  const jar = await cookies();
  jar.set(sessionCookieName(), sessionToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: sessionCookieName().startsWith("__Secure-"),
    expires,
  });
}

/**
 * Signs the current browser out, and deletes the row rather than only dropping
 * the cookie.
 *
 * A cookie cleared client-side leaves a working session token in the database
 * for another month. Anyone who captured it — a shared laptop, a proxy log —
 * still holds a key to the building's record. Signing out has to mean the token
 * stops working, not that this browser stops presenting it.
 */
export async function endSession(): Promise<void> {
  const jar = await cookies();
  const name = sessionCookieName();
  const token = jar.get(name)?.value;

  if (token) {
    await withUntenantedTx((tx) =>
      tx.session.deleteMany({ where: { sessionToken: token } }),
    );
  }

  jar.delete(name);
}

/**
 * Ends every session this user has except the one making the request.
 *
 * Called when a password changes. The reason to change one is usually that
 * somebody else might know it, and a change that leaves their existing sessions
 * alive fixes nothing.
 *
 * Every *other* one, though, and not this one as well. Deleting the caller's
 * own row and issuing a replacement looks equivalent and is not: the rest of
 * the same request still carries the old token, so the page re-rendering behind
 * the form finds no session, decides nobody is signed in, and bounces the
 * person who just changed their password to the sign-in screen. Leaving the
 * live session alone is both simpler and what the sentence on the form says.
 */
export async function endOtherSessions(userId: string): Promise<void> {
  const jar = await cookies();
  const current = jar.get(sessionCookieName())?.value;

  await withUntenantedTx((tx) =>
    tx.session.deleteMany({
      where: current ? { userId, NOT: { sessionToken: current } } : { userId },
    }),
  );
}
