"use server";

import { redirect } from "next/navigation";
import { setPassword } from "~/lib/auth/accounts";
import { sessionUserId } from "~/lib/auth/current";
import { endSession } from "~/lib/auth/sessions";
import { fail, type Result } from "~/lib/result";

/**
 * The two things a person can do to their own account.
 *
 * The user id comes from the session and never from the form. An account id in
 * a hidden field is a password reset for whoever edits it.
 */

export async function setPasswordAction(input: {
  current: string;
  password: string;
  confirm: string;
}): Promise<Result<null>> {
  const userId = await sessionUserId();
  if (!userId) return fail("unauthenticated", "Sign in first.");

  if (input.password !== input.confirm) {
    return fail("invalid", "Those two passwords are different.", {
      confirm: "This doesn't match the password above.",
    });
  }

  return setPassword(userId, { current: input.current, password: input.password });
}

export async function signOutAction(): Promise<void> {
  await endSession();
  redirect("/sign-in");
}
