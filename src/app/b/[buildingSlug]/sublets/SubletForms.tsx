"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, inputClass, textareaClass } from "~/components/patterns/Button";
import type { ApprovalAction } from "~/lib/primitives/approvals";
import {
  actOnSubletAction,
  applyToSubletAction,
  commentOnSubletAction,
  endSubletAction,
  postSubletFeeAction,
  renewSubletAction,
} from "./actions";

/**
 * Applying to sublet, and everything the board does about it.
 *
 * The application form belongs to the shareholder and asks only what a sublease
 * needs: who is moving in, for how long, and how to reach them. The decision
 * controls belong to the board, and the one that can be refused by the cap says
 * so on the page as well as in the write path — but the page never hides the
 * button, because "you can't do this and here is why" is more useful than a
 * control that quietly is not there.
 */

// --- Applying --------------------------------------------------------------

export function ApplyToSublet({
  buildingSlug,
  units,
  defaultStart,
  defaultEnd,
}: {
  buildingSlug: string;
  units: ReadonlyArray<{ id: string; label: string }>;
  defaultStart: string;
  defaultEnd: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [subtenantName, setSubtenantName] = useState("");
  const [contact, setContact] = useState("");
  const [termStart, setTermStart] = useState(defaultStart);
  const [termEnd, setTermEnd] = useState(defaultEnd);
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  if (units.length === 0) return null;

  function submit(): void {
    setError(null);
    setFieldError({});

    startTransition(async () => {
      const result = await applyToSubletAction({
        buildingSlug,
        unitId,
        subtenantName,
        subtenantContact: contact || null,
        termStart,
        termEnd,
        fee: fee || null,
        note: note || null,
      });

      if (result.ok) {
        setOpen(false);
        setSubtenantName("");
        setContact("");
        setNote("");
        router.push(`/b/${buildingSlug}/sublets/${result.data.subletId}`);
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  if (!open) {
    return (
      <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
        Apply to sublet
      </Button>
    );
  }

  return (
    <div className="sheet mb-6 px-4 py-4 text-left">
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Apartment">
          <select
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
            className={inputClass}
          >
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Who is moving in" error={fieldError["subtenantName"]}>
            <input
              value={subtenantName}
              onChange={(event) => setSubtenantName(event.target.value)}
              className={inputClass}
              placeholder="Delphine Okaro"
            />
          </Field>
        </div>

        <Field label="Term starts" error={fieldError["termStart"]}>
          <input
            type="date"
            value={termStart}
            onChange={(event) => setTermStart(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Term ends" error={fieldError["termEnd"]}>
          <input
            type="date"
            value={termEnd}
            onChange={(event) => setTermEnd(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field
          label="Sublet fee"
          hint="What the house rules set."
          error={fieldError["feeCents"]}
        >
          <input
            inputMode="decimal"
            value={fee}
            onChange={(event) => setFee(event.target.value)}
            className={inputClass}
            placeholder="1,200.00"
          />
        </Field>

        <div className="sm:col-span-3">
          <Field
            label="How to reach them"
            hint="A subtenant is not a member and gets no login, so this is where the building finds them."
          >
            <input
              value={contact}
              onChange={(event) => setContact(event.target.value)}
              className={inputClass}
              placeholder="delphine@example.com · 718-555-0164"
            />
          </Field>
        </div>
      </div>

      <div className="mt-3">
        <Field label="Anything the board should know">
          <textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={textareaClass}
            placeholder="Working abroad for a year and intend to come back."
          />
        </Field>
      </div>

      <div className="mt-4 flex gap-2">
        <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Applying…" : "Apply"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// --- Deciding --------------------------------------------------------------

const LABELS: Partial<Record<ApprovalAction, string>> = {
  startReview: "Start review",
  approve: "Approve",
  approveWithConditions: "Approve with conditions",
  deny: "Deny",
  withdraw: "Withdraw",
};

export function SubletDecision({
  buildingSlug,
  subletId,
  actions,
  capWarning,
}: {
  buildingSlug: string;
  subletId: string;
  actions: readonly ApprovalAction[];
  /** Set when approving would breach the cap, so the page can say so first. */
  capWarning: string | null;
}) {
  const [conditions, setConditions] = useState("");
  const [note, setNote] = useState("");
  const [showConditions, setShowConditions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function act(action: ApprovalAction): void {
    if (action === "approveWithConditions" && !showConditions) {
      setShowConditions(true);
      return;
    }

    setError(null);
    setFieldError({});
    startTransition(async () => {
      const result = await actOnSubletAction({
        buildingSlug,
        subletId,
        action,
        note: note || null,
        conditions: conditions || null,
      });
      if (result.ok) {
        setNote("");
        setConditions("");
        setShowConditions(false);
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  if (actions.length === 0) return null;

  return (
    <div>
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      {capWarning ? (
        <p className="border-stamp bg-stamp-soft text-ironwork mb-3 max-w-2xl border-l-2 px-3 py-2 text-sm">
          {capWarning}
        </p>
      ) : null}

      <div className="max-w-2xl">
        <Field label="Note" hint="Why, in the words the minutes would use.">
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={inputClass}
            placeholder="Standard one-year term, subtenant referenced."
          />
        </Field>
      </div>

      {showConditions ? (
        <div className="mt-3 max-w-2xl">
          <Field
            label="Conditions"
            hint="The operative part of the decision."
            error={fieldError["conditions"]}
          >
            <input
              value={conditions}
              onChange={(event) => setConditions(event.target.value)}
              className={inputClass}
              placeholder="One year only, not renewable. Subtenant's renter's insurance on file before move-in."
            />
          </Field>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            intent={
              action === "deny"
                ? "destructive"
                : action === "approve"
                  ? "primary"
                  : "secondary"
            }
            size="sm"
            disabled={pending}
            onClick={() => act(action)}
          >
            {LABELS[action] ?? action}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function SubletComment({
  buildingSlug,
  subletId,
  canPostInternal,
}: {
  buildingSlug: string;
  subletId: string;
  canPostInternal: boolean;
}) {
  const [body, setBody] = useState("");
  const [boardOnly, setBoardOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      {error ? (
        <p role="alert" className="text-stamp mb-2 text-sm">
          {error}
        </p>
      ) : null}

      <textarea
        rows={2}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        className={textareaClass}
        placeholder="Add to the thread"
        aria-label="Add a comment"
      />

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={pending || body.trim() === ""}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await commentOnSubletAction({
                buildingSlug,
                subletId,
                body,
                boardOnly,
              });
              if (result.ok) setBody("");
              else setError(result.message);
            })
          }
        >
          {pending ? "Posting…" : "Post"}
        </Button>

        {canPostInternal ? (
          <label className="text-ironwork-soft flex items-center gap-1.5 text-xs">
            <input
              type="checkbox"
              checked={boardOnly}
              onChange={(event) => setBoardOnly(event.target.checked)}
            />
            Board only — the shareholder won&rsquo;t see this
          </label>
        ) : null}
      </div>
    </div>
  );
}

// --- Ending early ----------------------------------------------------------

export function EndSublet({
  buildingSlug,
  subletId,
  defaultDate,
}: {
  buildingSlug: string;
  subletId: string;
  defaultDate: string;
}) {
  const [open, setOpen] = useState(false);
  const [endedOn, setEndedOn] = useState(defaultDate);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div>
        {error ? (
          <p role="alert" className="text-stamp mb-2 text-sm">
            {error}
          </p>
        ) : null}
        <Button size="sm" onClick={() => setOpen(true)}>
          Record that it ended early
        </Button>
      </div>
    );
  }

  return (
    <div className="sheet px-4 py-4">
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      <p className="text-ironwork-soft mb-3 max-w-2xl text-sm">
        This frees the apartment&rsquo;s slot under the cap from that day, so a
        neighbour whose application was refused may become approvable.
      </p>

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Last day" error={fieldError["endedOn"]}>
          <input
            type="date"
            value={endedOn}
            onChange={(event) => setEndedOn(event.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="Why">
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={inputClass}
              placeholder="Subtenant took a job out of state."
            />
          </Field>
        </div>
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          intent="primary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              setFieldError({});
              const result = await endSubletAction({
                buildingSlug,
                subletId,
                endedOn,
                reason: reason || null,
              });
              if (result.ok) setOpen(false);
              else {
                setError(result.message);
                setFieldError(result.fields ?? {});
              }
            })
          }
        >
          {pending ? "Recording…" : "Record it"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// --- The fee ---------------------------------------------------------------

export function PostSubletFee({
  buildingSlug,
  subletId,
  unitLabel,
  defaultAmount,
  defaultDueOn,
}: {
  buildingSlug: string;
  subletId: string;
  unitLabel: string;
  defaultAmount: string;
  defaultDueOn: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(defaultAmount);
  const [dueOn, setDueOn] = useState(defaultDueOn);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div>
        {error ? (
          <p role="alert" className="text-stamp mb-2 text-sm">
            {error}
          </p>
        ) : null}
        <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
          Charge the fee to {unitLabel}
        </Button>
      </div>
    );
  }

  return (
    <div className="sheet px-4 py-4">
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Amount" error={fieldError["amountCents"]}>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
            placeholder="1,200.00"
          />
        </Field>

        <Field label="Due" error={fieldError["dueOn"]}>
          <input
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          intent="primary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              setFieldError({});
              const result = await postSubletFeeAction({
                buildingSlug,
                subletId,
                amount: amount || null,
                dueOn,
              });
              if (result.ok) setOpen(false);
              else {
                setError(result.message);
                setFieldError(result.fields ?? {});
              }
            })
          }
        >
          {pending ? "Charging…" : `Charge ${unitLabel}`}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// --- Renewal ---------------------------------------------------------------

export function RenewSublet({
  buildingSlug,
  subletId,
  defaultEnd,
}: {
  buildingSlug: string;
  subletId: string;
  defaultEnd: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [termEnd, setTermEnd] = useState(defaultEnd);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <div>
        {error ? (
          <p role="alert" className="text-stamp mb-2 text-sm">
            {error}
          </p>
        ) : null}
        <Button size="sm" onClick={() => setOpen(true)}>
          Apply to renew
        </Button>
      </div>
    );
  }

  return (
    <div className="sheet px-4 py-4">
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      <p className="text-ironwork-soft mb-3 max-w-2xl text-sm">
        A renewal is a fresh application picking up the day after this term ends. The
        board has to approve it again, and the cap is checked again.
      </p>

      <div className="max-w-48">
        <Field label="The renewed term ends">
          <input
            type="date"
            value={termEnd}
            onChange={(event) => setTermEnd(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-4 flex gap-2">
        <Button
          intent="primary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await renewSubletAction({
                buildingSlug,
                subletId,
                termEnd,
              });
              if (result.ok) {
                setOpen(false);
                router.push(`/b/${buildingSlug}/sublets/${result.data.subletId}`);
              } else setError(result.message);
            })
          }
        >
          {pending ? "Applying…" : "Apply to renew"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
