import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "~/lib/auth/config";
import { lookupInvitation } from "~/lib/auth/invitations";
import { withUntenantedTx } from "~/lib/db/tx";
import { AcceptForm } from "./AcceptForm";

/**
 * The invitation landing page.
 *
 * Deliberately shows almost nothing before sign-in: the building's name and who
 * invited you, which the recipient already knows from the email, and no unit
 * labels, no member list, nothing about the building's records.
 *
 * The invitation is re-validated on accept, not trusted from this render. This
 * page may sit open for an hour, and the invitation may be revoked in the
 * meantime.
 */
export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const lookup = await lookupInvitation(token);

  if (!lookup.ok) {
    return (
      <Shell title="This invitation isn't usable">
        <p className="text-sm text-ironwork-soft">{lookup.reason}</p>
        <p className="mt-4 text-sm">
          <Link href="/sign-in" className="text-verdigris underline underline-offset-4">
            Sign in
          </Link>{" "}
          if you already have an account.
        </p>
      </Shell>
    );
  }

  const invitation = lookup.invitation;
  const session = await auth();
  const userId = session?.user?.id;

  const signedInAs = userId
    ? await withUntenantedTx((tx) =>
        tx.user.findUnique({ where: { id: userId }, select: { email: true } }),
      )
    : null;

  if (!signedInAs) {
    // Carry the invitation through sign-in so the link is not wasted.
    redirect(`/sign-in?invite=${encodeURIComponent(token)}`);
  }

  const matches =
    signedInAs.email.toLowerCase() === invitation.email.toLowerCase();

  return (
    <Shell title={`Join ${invitation.buildingName}`}>
      <p className="text-sm text-ironwork-soft">
        {invitation.invitedBy} invited{" "}
        <span className="font-mono text-ironwork">{invitation.email}</span> to
        keep the building&rsquo;s records on Co-operator.
      </p>

      {matches ? (
        <AcceptForm token={token} buildingName={invitation.buildingName} />
      ) : (
        <div className="mt-5 border-l-2 border-stamp bg-stamp-soft px-3 py-2">
          <p className="text-sm text-ironwork">
            You&rsquo;re signed in as{" "}
            <span className="font-mono">{signedInAs.email}</span>, and this
            invitation was sent to{" "}
            <span className="font-mono">{invitation.email}</span>.
          </p>
          <p className="mt-2 text-sm text-ironwork-soft">
            Sign in with the invited address, or ask {invitation.invitedBy} to
            send one to this address instead.
          </p>
          <p className="mt-3 text-sm">
            <Link
              href="/sign-in"
              className="text-verdigris underline underline-offset-4"
            >
              Sign in as someone else
            </Link>
          </p>
        </div>
      )}
    </Shell>
  );
}

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="sheet px-6 py-7">
        <p className="eyebrow">Co-operator</p>
        <h1 className="mt-2 font-display text-3xl leading-tight text-brownstone">
          {title}
        </h1>
        <div className="mt-4">{children}</div>
      </div>
      <p className="mt-6 text-xs leading-relaxed text-ironwork-faint">
        Co-operator is a tracking tool, not legal advice. The board remains
        responsible for the building&rsquo;s filings.
      </p>
    </main>
  );
}
