"use client";

import { useState, useTransition } from "react";
import { Button } from "~/components/patterns/Button";
import { reassessAction } from "./actions";

/**
 * Re-runs the applicability engine.
 *
 * Needed whenever the building's attributes change — a boiler converted from
 * oil to gas changes which laws apply, and nobody should have to know that a
 * background job exists in order to find out.
 *
 * A rule the board has already decided keeps its decision. When the engine's
 * verdict flips underneath one, that is reported here rather than silently
 * reversing the board's call.
 */
export function ReassessButton({ buildingSlug }: { buildingSlug: string }) {
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(): void {
    startTransition(async () => {
      const result = await reassessAction({ buildingSlug });
      if (!result.ok) {
        setMessage(result.message);
        return;
      }

      const { created, changed } = result.data;
      if (created === 0 && changed.length === 0) {
        setMessage("Nothing changed.");
      } else if (changed.length > 0) {
        setMessage(
          `${created} new to review. ${changed.length} already decided now look different — check them.`,
        );
      } else {
        setMessage(`${created} new to review.`);
      }
    });
  }

  return (
    <div className="text-right">
      <Button size="sm" disabled={pending} onClick={run}>
        {pending ? "Checking…" : "Check what applies"}
      </Button>
      {message ? (
        <p className="mt-1.5 max-w-xs text-xs text-ironwork-soft">{message}</p>
      ) : null}
    </div>
  );
}
