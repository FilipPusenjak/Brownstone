"use server";

import { redirect } from "next/navigation";
import { signInWithPassword } from "~/lib/auth/accounts";
import { signIn } from "~/lib/auth/config";
import { fail, ok, type Result } from "~/lib/result";

/**
 * The two ways in.
 *
 * A password, which works when the mail does not, and an emailed link, which
 * works when the password has been forgotten. Neither is a fallback for the
 * other so much as each is the other's recovery path, which is why both stay.
 */

/** Where to land after signing in: the invitation, if one brought them here. */
function destination(invite: string | null): string {
  return invite ? `/invite/${invite}` : "/";
}

/**
 * Redirects on success rather than handing a destination back to the browser.
 *
 * The session cookie is set on this response, and the client-side router is
 * holding a signed-out copy of every page it has already seen. Navigating from
 * the server discards that cache along with the redirect, which a `push()` from
 * the form would not.
 */
export async function signInWithPasswordAction(input: {
  email: string;
  password: string;
  invite: string | null;
}): Promise<Result<null>> {
  const result = await signInWithPassword(input.email, input.password);
  if (!result.ok) return result;

  // Outside any try/catch: `redirect` signals by throwing.
  redirect(destination(input.invite));
}

/**
 * Sends a sign-in link, and says so when it cannot.
 *
 * Auth.js's own handling of a send failure is a redirect to the error page with
 * `?error=Configuration`, which tells the person at the keyboard nothing and
 * the person maintaining the deployment less. A bounced address and an
 * unverified sending domain are the two most likely reasons a co-op's sign-in
 * quietly stops working, and both are fixable the moment somebody can read the
 * message. So the provider's reason is passed through.
 */
export async function sendSignInLinkAction(input: {
  email: string;
  invite: string | null;
}): Promise<Result<null>> {
  const email = input.email.trim();
  if (!email) return fail("invalid", "Enter your email address.");

  try {
    await signIn("email", {
      email,
      redirect: false,
      redirectTo: destination(input.invite),
    });
    return ok(null);
  } catch (error) {
    const cause =
      error instanceof Error ? (error.cause as { err?: Error } | undefined) : undefined;
    const detail = cause?.err?.message ?? (error instanceof Error ? error.message : "");
    return fail(
      "unavailable",
      detail
        ? `The link couldn't be sent: ${detail}`
        : "The link couldn't be sent. Ask whoever set up this deployment to check the mail settings.",
    );
  }
}
