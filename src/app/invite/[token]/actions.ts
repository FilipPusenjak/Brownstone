"use server";

import { redirect } from "next/navigation";
import { createAccountFromInvitation } from "~/lib/auth/accounts";
import { auth } from "~/lib/auth/config";
import { acceptInvitation, type AcceptedInvitation } from "~/lib/auth/invitations";
import { withUntenantedTx } from "~/lib/db/tx";
import { fail, type Result } from "~/lib/result";

/**
 * Redeeming an invitation.
 *
 * The user's identity comes from the session, never from the form. A posted
 * email address would let anyone with a token claim any invitation.
 */
export async function acceptInvitationAction(input: {
  token: string;
}): Promise<Result<AcceptedInvitation>> {
  const session = await auth();
  const userId = session?.user?.id;

  if (!userId) {
    return fail("unauthenticated", "Sign in first, then open the invitation again.");
  }

  const user = await withUntenantedTx((tx) =>
    tx.user.findUnique({ where: { id: userId }, select: { id: true, email: true } }),
  );
  if (!user) {
    return fail("unauthenticated", "Your session has expired. Sign in again.");
  }

  return acceptInvitation(input.token, user);
}

/**
 * Creating an account from the invitation, and joining in the same step.
 *
 * The address is never posted: it comes from the invitation the token names, so
 * a form cannot be edited into claiming somebody else's. The password is
 * confirmed here rather than in `createAccountFromInvitation`, because a typo
 * in a password nobody can see is a user-interface problem and not a rule about
 * accounts.
 */
export async function createAccountAction(input: {
  token: string;
  name: string;
  password: string;
  confirm: string;
}): Promise<Result<null>> {
  if (input.password !== input.confirm) {
    return fail("invalid", "Those two passwords are different.", {
      confirm: "This doesn't match the password above.",
    });
  }

  const created = await createAccountFromInvitation(input.token, {
    name: input.name,
    password: input.password,
  });
  if (!created.ok) return created;

  // From the server, so the router's signed-out cache goes with the redirect.
  // Outside any try/catch: `redirect` signals by throwing.
  redirect(`/b/${created.data.buildingSlug}`);
}
