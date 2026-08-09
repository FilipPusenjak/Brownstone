"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "~/components/patterns/Button";
import { acceptInvitationAction } from "./actions";

/**
 * Accepting.
 *
 * A button rather than an automatic redemption on page load: a link prefetched
 * by a mail client or a corporate scanner would otherwise consume the
 * invitation before the person ever saw it.
 */
export function AcceptForm({
  token,
  buildingName,
}: {
  token: string;
  buildingName: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function accept(): void {
    setError(null);
    startTransition(async () => {
      const result = await acceptInvitationAction({ token });
      if (result.ok) {
        router.push(`/b/${result.data.buildingSlug}`);
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div className="mt-5">
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      <Button intent="primary" disabled={pending} onClick={accept}>
        {pending ? "Joining…" : `Join ${buildingName}`}
      </Button>
    </div>
  );
}
