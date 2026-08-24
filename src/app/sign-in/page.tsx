import Link from "next/link";
import { sessionUserId } from "~/lib/auth/current";
import { withUntenantedTx } from "~/lib/db/tx";
import { SignInForm } from "./SignInForm";

/**
 * Sign in.
 *
 * Two ways, and the reason there are two is worth stating. Co-operator shipped
 * with emailed links alone, on the reasoning that a three-person board will not
 * configure OAuth and that a password is one more thing to lose. What that
 * reasoning missed is what happens when the mail does not arrive — an
 * unverified sending domain, a spam filter, an address that bounces — which is
 * a board locked out of its own building's record with no way back in.
 *
 * So a password is the everyday key and the link is the spare. An account is
 * created from an invitation rather than from a form here: membership in a
 * building comes from being invited to it, and an account without one would be
 * a sign-in that leads to an empty room.
 */

/**
 * An invitation token carried through sign-in.
 *
 * The token is minted as base64url, so anything outside that alphabet did not
 * come from us and is dropped. This is the only user-supplied value that ends
 * up in a redirect target, and a token that is echoed back unchecked is how a
 * sign-in page becomes an open redirect.
 */
function safeInviteToken(value: string | undefined): string | null {
  if (!value) return null;
  return /^[A-Za-z0-9_-]{20,200}$/.test(value) ? value : null;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  const token = safeInviteToken(invite);

  // Somebody already signed in still gets the form. Redirecting them away would
  // break the one case that brings a signed-in person here on purpose: an
  // invitation sent to their other address, where the way forward is to sign in
  // as somebody else. The note below says who they currently are, because
  // signing in "again" and landing somewhere unexpected is the confusing half.
  const userId = await sessionUserId();
  const signedInAs = userId
    ? await withUntenantedTx((tx) =>
        tx.user.findUnique({ where: { id: userId }, select: { email: true } }),
      )
    : null;

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="sheet px-6 py-7">
        <p className="eyebrow">Co-operator</p>
        <h1 className="font-display text-brownstone mt-2 text-3xl leading-tight">
          Sign in
        </h1>
        <p className="text-ironwork-soft mt-3 text-sm">
          {token
            ? "Use the address your invitation was sent to — it only works for that one. You’ll come straight back here."
            : "Your email address and your password."}
        </p>

        {signedInAs ? (
          <div className="border-limestone-deep bg-paper-sunk mt-4 border-l-2 px-3 py-2">
            <p className="text-ironwork-soft text-sm">
              You&rsquo;re already signed in as{" "}
              <span className="text-ironwork font-mono">{signedInAs.email}</span>.{" "}
              <Link
                href={token ? `/invite/${token}` : "/"}
                className="text-verdigris underline underline-offset-4"
              >
                Carry on as them
              </Link>
              , or sign in below as somebody else.
            </p>
          </div>
        ) : null}

        <SignInForm invite={token} />
      </div>

      <p className="text-ironwork-faint mt-6 text-xs leading-relaxed">
        No account yet? A Co-operator account comes with an invitation from your board —
        ask them to send you one, and you&rsquo;ll choose a password on the way in.
      </p>

      <p className="text-ironwork-faint mt-3 text-xs leading-relaxed">
        Co-operator is a tracking tool, not legal advice. The board remains responsible
        for the building&rsquo;s filings.
      </p>
    </main>
  );
}
