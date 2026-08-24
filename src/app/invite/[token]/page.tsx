import Link from "next/link";
import { auth } from "~/lib/auth/config";
import { lookupInvitation } from "~/lib/auth/invitations";
import { withUntenantedTx } from "~/lib/db/tx";
import { AcceptForm } from "./AcceptForm";
import { CreateAccountForm } from "./CreateAccountForm";

/**
 * The invitation landing page, and the only way an account gets made.
 *
 * Deliberately shows almost nothing before sign-in: the building's name and who
 * invited you, which the recipient already knows from the email, and no unit
 * labels, no member list, nothing about the building's records.
 *
 * Three states, decided by what already exists for the invited address:
 *
 * - **No account.** Choose a name and a password and you are in, one step, no
 *   second email to wait for. Holding the token is the proof of the address —
 *   it was mailed there and stored only as a hash — so a confirmation round
 *   trip would collect an assurance already in hand.
 * - **An account, not signed in.** Sign in first. A token may create an account
 *   and may never adopt one: a board in another building can invite any address
 *   it likes, and letting the token set a password on an existing account would
 *   hand them somebody else's building.
 * - **Signed in.** The button, and the address has to match.
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
        <p className="text-ironwork-soft text-sm">{lookup.reason}</p>
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
    const existing = await withUntenantedTx((tx) =>
      tx.user.findUnique({
        where: { email: invitation.email.toLowerCase() },
        select: { id: true },
      }),
    );

    if (!existing) {
      return (
        <Shell title={`Join ${invitation.buildingName}`}>
          <p className="text-ironwork-soft text-sm">
            {invitation.invitedBy} invited{" "}
            <span className="text-ironwork font-mono">{invitation.email}</span> to keep
            the building&rsquo;s records on Co-operator. Pick a password and
            you&rsquo;re in — there&rsquo;s no second email to wait for.
          </p>
          <CreateAccountForm
            token={token}
            email={invitation.email}
            buildingName={invitation.buildingName}
          />
        </Shell>
      );
    }

    // The address already has an account. Signing in is the only way to attach
    // this invitation to it — see the note at the top of the file.
    return (
      <Shell title={`Join ${invitation.buildingName}`}>
        <p className="text-ironwork-soft text-sm">
          {invitation.invitedBy} invited{" "}
          <span className="text-ironwork font-mono">{invitation.email}</span> to keep
          the building&rsquo;s records on Co-operator.
        </p>
        <p className="text-ironwork-soft mt-3 text-sm">
          That address already has a Co-operator account. Sign in with it and
          you&rsquo;ll come straight back here.
        </p>
        <p className="mt-4 text-sm">
          <Link
            href={`/sign-in?invite=${encodeURIComponent(token)}`}
            className="text-verdigris underline underline-offset-4"
          >
            Sign in
          </Link>
        </p>
      </Shell>
    );
  }

  const matches = signedInAs.email.toLowerCase() === invitation.email.toLowerCase();

  return (
    <Shell title={`Join ${invitation.buildingName}`}>
      <p className="text-ironwork-soft text-sm">
        {invitation.invitedBy} invited{" "}
        <span className="text-ironwork font-mono">{invitation.email}</span> to keep the
        building&rsquo;s records on Co-operator.
      </p>

      {matches ? (
        <AcceptForm token={token} buildingName={invitation.buildingName} />
      ) : (
        <div className="border-stamp bg-stamp-soft mt-5 border-l-2 px-3 py-2">
          <p className="text-ironwork text-sm">
            You&rsquo;re signed in as{" "}
            <span className="font-mono">{signedInAs.email}</span>, and this invitation
            was sent to <span className="font-mono">{invitation.email}</span>.
          </p>
          <p className="text-ironwork-soft mt-2 text-sm">
            Sign in with the invited address, or ask {invitation.invitedBy} to send one
            to this address instead.
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
        <h1 className="font-display text-brownstone mt-2 text-3xl leading-tight">
          {title}
        </h1>
        <div className="mt-4">{children}</div>
      </div>
      <p className="text-ironwork-faint mt-6 text-xs leading-relaxed">
        Co-operator is a tracking tool, not legal advice. The board remains responsible
        for the building&rsquo;s filings.
      </p>
    </main>
  );
}
