"use client";

import { useState, useTransition } from "react";
import { Button } from "~/components/patterns/Button";
import { revokeInvitationAction } from "./actions";

/**
 * Withdrawing an invitation.
 *
 * Two clicks, because the first one is often a misread of the row: in a list of
 * six neighbours the wrong line is easy to hit, and the invitation cannot be
 * un-revoked.
 */
export function RevokeButton({
  buildingSlug,
  invitationId,
  email,
}: {
  buildingSlug: string;
  invitationId: string;
  email: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function revoke(): void {
    setError(null);
    startTransition(async () => {
      const result = await revokeInvitationAction({ buildingSlug, invitationId });
      if (!result.ok) {
        setError(result.message);
        setConfirming(false);
      }
    });
  }

  if (error) {
    return <span className="text-stamp text-xs">{error}</span>;
  }

  if (!confirming) {
    return (
      <Button intent="quiet" size="sm" onClick={() => setConfirming(true)}>
        Withdraw
      </Button>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        intent="destructive"
        size="sm"
        disabled={pending}
        onClick={revoke}
        aria-label={`Withdraw the invitation to ${email}`}
      >
        {pending ? "Withdrawing…" : "Withdraw it"}
      </Button>
      <Button intent="quiet" size="sm" onClick={() => setConfirming(false)}>
        Keep it
      </Button>
    </span>
  );
}
