"use client";

import { useState, useTransition } from "react";
import { Button, Field, inputClass, textareaClass } from "~/components/patterns/Button";
import { formatDate, isPlainDate, plainDate } from "~/lib/time";
import {
  completeObligationAction,
  reopenObligationAction,
  waiveObligationAction,
} from "./actions";

/**
 * Closing out a filing.
 *
 * "We filed this" and "we don't have to file this" are different facts and get
 * different buttons. Conflating them would let a building's record claim a
 * filing that never happened, which is the one thing a compliance record must
 * never do.
 *
 * Completing tells you when the next one is due, because that is the question
 * a board member has the moment they finish.
 */
export function ObligationActions({
  buildingSlug,
  obligationId,
  state,
  canComplete,
  canManage,
  today,
}: {
  buildingSlug: string;
  obligationId: string;
  state: "OPEN" | "COMPLETED" | "WAIVED" | "NOT_APPLICABLE";
  canComplete: boolean;
  canManage: boolean;
  today: string;
}) {
  const [mode, setMode] = useState<"idle" | "completing" | "waiving">("idle");
  const [completedOn, setCompletedOn] = useState(today);
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function reset(): void {
    setError(null);
    setFieldError({});
  }

  function complete(): void {
    reset();
    startTransition(async () => {
      const result = await completeObligationAction({
        buildingSlug,
        obligationId,
        completedOn,
        note: note || null,
      });
      if (result.ok) {
        setMode("idle");
        // The action keeps its name through the flow: "Mark it filed" produces
        // "Filed", and then answers the next question without being asked.
        const next = result.data.nextDueOn;
        setMessage(
          next && isPlainDate(next)
            ? `Filed. The next one is due ${formatDate(plainDate(next))}.`
            : "Filed.",
        );
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  function waive(notApplicable: boolean): void {
    reset();
    startTransition(async () => {
      const result = await waiveObligationAction({
        buildingSlug,
        obligationId,
        reason,
        notApplicable,
      });
      if (result.ok) {
        setMode("idle");
        setMessage("Removed from the calendar.");
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  function reopen(): void {
    reset();
    startTransition(async () => {
      const result = await reopenObligationAction({ buildingSlug, obligationId });
      if (result.ok) setMessage("Reopened.");
      else setError(result.message);
    });
  }

  if (state !== "OPEN") {
    return (
      <div className="flex flex-wrap items-center gap-3">
        {canManage ? (
          <Button size="sm" disabled={pending} onClick={reopen}>
            {pending ? "Reopening…" : "Reopen"}
          </Button>
        ) : null}
        {message ? <span className="text-ironwork-soft text-xs">{message}</span> : null}
        {error ? (
          <span role="alert" className="text-stamp text-xs">
            {error}
          </span>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      {message ? (
        <p className="border-complete-line bg-complete-soft text-ironwork mb-3 border-l-2 px-3 py-2 text-sm">
          {message}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      {mode === "idle" ? (
        <div className="flex flex-wrap gap-2">
          {canComplete ? (
            <Button intent="primary" onClick={() => setMode("completing")}>
              Mark it filed
            </Button>
          ) : null}
          {canManage ? (
            <Button onClick={() => setMode("waiving")}>Take it off the calendar</Button>
          ) : null}
        </div>
      ) : null}

      {mode === "completing" ? (
        <div className="sheet px-4 py-3">
          <Field label="Date filed" error={fieldError["completedOn"]}>
            <input
              type="date"
              max={today}
              value={completedOn}
              onChange={(event) => setCompletedOn(event.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="mt-3">
            <Field
              label="Note"
              hint="Confirmation number, who did the inspection, anything the next board will want."
            >
              <textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={textareaClass}
                placeholder="Filed online. Confirmation 4471902."
              />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button intent="primary" size="sm" disabled={pending} onClick={complete}>
              {pending ? "Recording…" : "Mark it filed"}
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "waiving" ? (
        <div className="sheet px-4 py-3">
          <Field
            label="Why is this coming off?"
            hint="A future board will read this. A sentence is enough."
            error={fieldError["reason"]}
          >
            <textarea
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={textareaClass}
              placeholder="Confirmed with DOB that this doesn't apply below seven storeys."
            />
          </Field>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={pending} onClick={() => waive(true)}>
              Doesn&rsquo;t apply to us
            </Button>
            <Button size="sm" disabled={pending} onClick={() => waive(false)}>
              Waive this year
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
