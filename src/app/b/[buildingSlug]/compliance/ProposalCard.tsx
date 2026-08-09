"use client";

import { useState, useTransition } from "react";
import { Button, Field, inputClass, textareaClass } from "~/components/patterns/Button";
import { UnverifiedChip } from "~/components/patterns/StatusChip";
import { confirmRuleAction, dismissRuleAction } from "./actions";

/**
 * One proposal in the board's review queue.
 *
 * The board asked for a review list rather than an auto-generated calendar, so
 * this is where a requirement becomes something the building is tracking. Two
 * things follow from that:
 *
 *   Confirming asks for a date when the engine cannot derive one, rather than
 *   inventing a plausible-looking deadline.
 *
 *   Dismissing requires a reason, kept forever. When the next board asks why
 *   the building isn't tracking gas inspections, the answer has a name and a
 *   date on it.
 */

export interface Proposal {
  readonly ruleCode: string;
  readonly title: string;
  readonly citation: string;
  readonly requirement: string;
  readonly engineReason: string;
  readonly needsVerification: boolean;
  readonly verificationNote: string | null;
  readonly sourceUrl: string | null;
  /** Set when the rule's first due date cannot be worked out on its own. */
  readonly needsDateReason: string | null;
  readonly suggestedDueOn: string | null;
}

export function ProposalCard({
  proposal,
  buildingSlug,
}: {
  proposal: Proposal;
  buildingSlug: string;
}) {
  const [mode, setMode] = useState<"idle" | "confirming" | "dismissing">("idle");
  const [dueOn, setDueOn] = useState(proposal.suggestedDueOn ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function confirm(): void {
    setError(null);
    setFieldError({});
    startTransition(async () => {
      const result = await confirmRuleAction({
        buildingSlug,
        ruleCode: proposal.ruleCode,
        dueOn: dueOn || null,
      });
      if (!result.ok) {
        setError(result.message);
        setFieldError(result.fields ?? {});
        setMode("confirming");
      }
    });
  }

  function dismiss(): void {
    setError(null);
    setFieldError({});
    startTransition(async () => {
      const result = await dismissRuleAction({
        buildingSlug,
        ruleCode: proposal.ruleCode,
        note,
      });
      if (!result.ok) {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  return (
    <li className="sheet px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-medium text-ironwork">{proposal.title}</span>
        <span className="font-mono text-[0.6875rem] text-ironwork-faint">
          {proposal.citation}
        </span>
      </div>

      <p className="mt-1.5 text-sm text-ironwork-soft">{proposal.requirement}</p>
      <p className="mt-1.5 font-mono text-[0.6875rem] text-verdigris">
        {proposal.engineReason}
      </p>

      {proposal.needsVerification ? (
        <p className="mt-2 flex flex-wrap items-baseline gap-2 text-xs text-ironwork-faint">
          <UnverifiedChip />
          <span className="min-w-0 flex-1">{proposal.verificationNote}</span>
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-2 text-xs text-stamp">
          {error}
        </p>
      ) : null}

      {mode === "idle" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            intent="primary"
            size="sm"
            disabled={pending}
            onClick={() => (proposal.needsDateReason ? setMode("confirming") : confirm())}
          >
            {pending ? "Adding…" : "Add to the calendar"}
          </Button>
          <Button size="sm" disabled={pending} onClick={() => setMode("dismissing")}>
            Doesn&rsquo;t apply to us
          </Button>
          {proposal.sourceUrl ? (
            <a
              href={proposal.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center px-2 py-1 text-xs text-ironwork-soft underline underline-offset-4 hover:text-ironwork"
            >
              Read the rule
            </a>
          ) : null}
        </div>
      ) : null}

      {mode === "confirming" ? (
        <div className="mt-3 border-t border-limestone pt-3">
          {proposal.needsDateReason ? (
            <p className="mb-2 text-xs text-ironwork-soft">{proposal.needsDateReason}</p>
          ) : null}
          <Field label="Due date" error={fieldError["dueOn"]}>
            <input
              type="date"
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
              className={inputClass}
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button intent="primary" size="sm" disabled={pending} onClick={confirm}>
              {pending ? "Adding…" : "Add to the calendar"}
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {mode === "dismissing" ? (
        <div className="mt-3 border-t border-limestone pt-3">
          <Field
            label="Why doesn't this apply?"
            hint="A future board will read this. A sentence is enough."
            error={fieldError["note"]}
          >
            <textarea
              rows={2}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              className={textareaClass}
              placeholder="No gas service — the building went all-electric in 2019."
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button size="sm" disabled={pending} onClick={dismiss}>
              {pending ? "Recording…" : "Record and remove"}
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setMode("idle")}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}
