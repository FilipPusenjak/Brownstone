"use server";

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
