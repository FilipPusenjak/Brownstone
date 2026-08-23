"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type {
  Responsibility,
  TicketPriority,
  TicketStatus,
} from "~/generated/prisma/enums";
import { Button, Field, inputClass, textareaClass } from "~/components/patterns/Button";
import {
  chargeTicketAction,
  commentOnTicketAction,
  decideResponsibilityAction,
  openDeterminationAction,
  reportTicketAction,
  resolveTicketAction,
  setTicketStatusAction,
  triageTicketAction,
} from "./actions";

/**
 * The repair workflow, as the people in the building actually use it.
 *
 * A shareholder gets one control — report something — and it asks for the two
 * things that matter: what is wrong and where. Everything else on this page
 * belongs to whoever is going to deal with it.
 *
 * The one deliberately heavy control is billing. It asks twice, and says out
 * loud whose ledger the money is about to land on, because that is a repair
 * turning into a neighbour's debt.
 */

const PRIORITIES: ReadonlyArray<{ value: TicketPriority; label: string }> = [
  { value: "LOW", label: "Whenever" },
  { value: "NORMAL", label: "Normal" },
  { value: "URGENT", label: "Urgent" },
  { value: "EMERGENCY", label: "Emergency" },
];

const STATUSES: ReadonlyArray<{ value: TicketStatus; label: string }> = [
  { value: "OPEN", label: "Reported" },
  { value: "TRIAGED", label: "Triaged" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
];

const RESPONSIBILITIES: ReadonlyArray<{ value: Responsibility; label: string }> = [
  { value: "COOPERATIVE", label: "The co-op pays" },
  { value: "SHAREHOLDER", label: "The shareholder pays" },
  { value: "SHARED", label: "Shared between them" },
];

// --- Reporting -------------------------------------------------------------

export function ReportTicket({
  buildingSlug,
  units,
  canReportForOthers,
}: {
  buildingSlug: string;
  units: ReadonlyArray<{ id: string; label: string }>;
  canReportForOthers: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [unitId, setUnitId] = useState("");
  const [area, setArea] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("NORMAL");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});

    startTransition(async () => {
      const result = await reportTicketAction({
        buildingSlug,
        title,
        detail,
        unitId: unitId || null,
        area: area || null,
        priority,
      });

      if (result.ok) {
        setOpen(false);
        setTitle("");
        setDetail("");
        setArea("");
        router.push(`/b/${buildingSlug}/tickets/${result.data.ticketId}`);
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  if (!open) {
    return (
      <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
        Report a repair
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
        <div className="sm:col-span-2">
          <Field label="What's wrong" error={fieldError["title"]}>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={inputClass}
              placeholder="Radiator knocking overnight"
            />
          </Field>
        </div>

        <Field label="How urgent">
          <select
            value={priority}
            onChange={(event) => setPriority(event.target.value as TicketPriority)}
            className={inputClass}
          >
            {PRIORITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Where"
          hint={
            canReportForOthers
              ? "Leave blank for anywhere shared."
              : "Your apartment, or blank for somewhere shared."
          }
        >
          <select
            value={unitId}
            onChange={(event) => setUnitId(event.target.value)}
            className={inputClass}
          >
            <option value="">Somewhere shared</option>
            {units.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.label}
              </option>
            ))}
          </select>
        </Field>

        <div className="sm:col-span-2">
          <Field label="Which part of the building" hint="Only if it's shared.">
            <input
              value={area}
              onChange={(event) => setArea(event.target.value)}
              className={inputClass}
              placeholder="Vestibule, roof, boiler room"
            />
          </Field>
        </div>
      </div>

      <div className="mt-3">
        <Field label="Describe it" error={fieldError["detail"]}>
          <textarea
            rows={3}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            className={textareaClass}
            placeholder="Where it is, when it started, whether it's getting worse — enough for whoever turns up to bring the right tools."
          />
        </Field>
      </div>

      <div className="mt-4 flex gap-2">
        <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Reporting…" : "Report it"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// --- Triage ----------------------------------------------------------------

export function TicketControls({
  buildingSlug,
  ticketId,
  status,
  priority,
  assigneeId,
  vendorName,
  vendorPhone,
  members,
}: {
  buildingSlug: string;
  ticketId: string;
  status: TicketStatus;
  priority: TicketPriority;
  assigneeId: string | null;
  vendorName: string | null;
  vendorPhone: string | null;
  members: ReadonlyArray<{ id: string; name: string }>;
}) {
  const [vendor, setVendor] = useState(vendorName ?? "");
  const [phone, setPhone] = useState(vendorPhone ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function triage(next: Parameters<typeof triageTicketAction>[0]): void {
    setError(null);
    startTransition(async () => {
      const result = await triageTicketAction(next);
      if (!result.ok) setError(result.message);
    });
  }

  return (
    <div>
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Where it's up to">
          <select
            value={status}
            disabled={pending}
            onChange={(event) =>
              startTransition(async () => {
                setError(null);
                const result = await setTicketStatusAction({
                  buildingSlug,
                  ticketId,
                  status: event.target.value as TicketStatus,
                });
                if (!result.ok) setError(result.message);
              })
            }
            className={inputClass}
          >
            {STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="How urgent">
          <select
            value={priority}
            disabled={pending}
            onChange={(event) =>
              triage({
                buildingSlug,
                ticketId,
                priority: event.target.value as TicketPriority,
              })
            }
            className={inputClass}
          >
            {PRIORITIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Who's looking at it" hint="Someone in the building.">
          <select
            value={assigneeId ?? ""}
            disabled={pending}
            onChange={(event) =>
              triage({ buildingSlug, ticketId, assigneeId: event.target.value || null })
            }
            className={inputClass}
          >
            <option value="">Nobody yet</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
              </option>
            ))}
          </select>
        </Field>

        <div>
          <Field label="Or an outside contractor">
            <input
              value={vendor}
              onChange={(event) => setVendor(event.target.value)}
              onBlur={() =>
                vendor !== (vendorName ?? "")
                  ? triage({ buildingSlug, ticketId, vendorName: vendor })
                  : undefined
              }
              className={inputClass}
              placeholder="Brennan Plumbing"
            />
          </Field>
        </div>

        <div>
          <Field label="Their number">
            <input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              onBlur={() =>
                phone !== (vendorPhone ?? "")
                  ? triage({ buildingSlug, ticketId, vendorPhone: phone })
                  : undefined
              }
              className={inputClass}
              placeholder="718-555-0148"
            />
          </Field>
        </div>
      </div>
    </div>
  );
}

// --- Resolution ------------------------------------------------------------

export function ResolveTicket({
  buildingSlug,
  ticketId,
  initialNote,
  initialCost,
}: {
  buildingSlug: string;
  ticketId: string;
  initialNote: string;
  initialCost: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(initialNote);
  const [cost, setCost] = useState(initialCost);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});
    startTransition(async () => {
      const result = await resolveTicketAction({
        buildingSlug,
        ticketId,
        note,
        cost: cost || null,
      });
      if (result.ok) setOpen(false);
      else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  if (!open) {
    return (
      <div>
        {error ? (
          <p role="alert" className="text-stamp mb-2 text-sm">
            {error}
          </p>
        ) : null}
        <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
          Record what was done
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

      <Field
        label="What was done"
        hint="Specific enough that the next board knows whether this is the same fault coming back."
        error={fieldError["note"]}
      >
        <textarea
          rows={3}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          className={textareaClass}
          placeholder="Replaced the flush valve, not the whole tank. Tank itself is original and will need doing eventually."
        />
      </Field>

      <div className="mt-3 max-w-48">
        <Field label="What it cost" hint="Optional." error={fieldError["costCents"]}>
          <input
            inputMode="decimal"
            value={cost}
            onChange={(event) => setCost(event.target.value)}
            className={inputClass}
            placeholder="350.00"
          />
        </Field>
      </div>

      <div className="mt-4 flex gap-2">
        <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Saving…" : "Save"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// --- Who pays --------------------------------------------------------------

export function OpenDetermination({
  buildingSlug,
  ticketId,
}: {
  buildingSlug: string;
  ticketId: string;
}) {
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
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
          Ask the board who pays
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

      <Field
        label="Why you're asking"
        hint="Optional, but it's the first thing in the thread the board reads."
      >
        <textarea
          rows={2}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          className={textareaClass}
          placeholder="The pipe is behind the wall, so I think this one is the corporation's."
        />
      </Field>

      <div className="mt-4 flex gap-2">
        <Button
          intent="primary"
          size="sm"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await openDeterminationAction({
                buildingSlug,
                ticketId,
                question: question || null,
              });
              if (result.ok) setOpen(false);
              else setError(result.message);
            })
          }
        >
          {pending ? "Asking…" : "Put it to the board"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Recording who pays.
 *
 * There is no "deny" button, and that is on purpose: a repair always has
 * somebody responsible for it, so the board records the answer rather than
 * rejecting the question.
 */
export function DecideResponsibility({
  buildingSlug,
  ticketId,
  hasUnit,
}: {
  buildingSlug: string;
  ticketId: string;
  hasUnit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [responsibility, setResponsibility] = useState<Responsibility>(
    hasUnit ? "COOPERATIVE" : "COOPERATIVE",
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const choices = hasUnit
    ? RESPONSIBILITIES
    : RESPONSIBILITIES.filter((choice) => choice.value === "COOPERATIVE");

  if (!open) {
    return (
      <div>
        {error ? (
          <p role="alert" className="text-stamp mb-2 text-sm">
            {error}
          </p>
        ) : null}
        <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
          Record who pays
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

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Who pays" error={fieldError["responsibility"]}>
          <select
            value={responsibility}
            onChange={(event) =>
              setResponsibility(event.target.value as Responsibility)
            }
            className={inputClass}
          >
            {choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-3">
        <Field
          label="On what basis"
          hint="The part of the lease or house rules it turns on. This is what a shareholder gets shown if they contest it."
        >
          <textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={textareaClass}
            placeholder="Fixture inside the apartment. Paragraph 18 of the proprietary lease."
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
              const result = await decideResponsibilityAction({
                buildingSlug,
                ticketId,
                action: "approve",
                responsibility,
                note: note || null,
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

export function TicketComment({
  buildingSlug,
  ticketId,
  canPostInternal,
}: {
  buildingSlug: string;
  ticketId: string;
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
              const result = await commentOnTicketAction({
                buildingSlug,
                ticketId,
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

// --- The bill --------------------------------------------------------------

/**
 * Billing the apartment.
 *
 * Asks twice, and names the apartment out loud in the confirmation, because
 * this is the moment a repair becomes a neighbour's debt.
 */
export function ChargeTicket({
  buildingSlug,
  ticketId,
  unitLabel,
  defaultAmount,
  defaultDueOn,
}: {
  buildingSlug: string;
  ticketId: string;
  unitLabel: string;
  defaultAmount: string;
  defaultDueOn: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [amount, setAmount] = useState(defaultAmount);
  const [dueOn, setDueOn] = useState(defaultDueOn);
  const [memo, setMemo] = useState("");
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
          Bill {unitLabel} for this
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
            placeholder="350.00"
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

        <Field label="Memo" hint="What appears on the ledger.">
          <input
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            className={inputClass}
            placeholder="Leave blank to use the repair's name"
          />
        </Field>
      </div>

      {confirming ? (
        <div className="border-stamp bg-stamp-soft mt-4 border-l-2 px-3 py-2">
          <p className="text-ironwork text-sm">
            This puts {amount || "—"} on {unitLabel}&rsquo;s ledger, due {dueOn}.
            Correcting it afterwards means a reversing entry, not an edit.
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        {confirming ? (
          <Button
            intent="primary"
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                setFieldError({});
                const result = await chargeTicketAction({
                  buildingSlug,
                  ticketId,
                  amount,
                  dueOn,
                  memo: memo || null,
                });
                if (result.ok) {
                  setOpen(false);
                  setConfirming(false);
                } else {
                  setError(result.message);
                  setFieldError(result.fields ?? {});
                  setConfirming(false);
                }
              })
            }
          >
            {pending ? "Billing…" : `Yes, bill ${unitLabel}`}
          </Button>
        ) : (
          <Button intent="primary" size="sm" onClick={() => setConfirming(true)}>
            Bill it
          </Button>
        )}
        <Button
          intent="quiet"
          size="sm"
          onClick={() => {
            setOpen(false);
            setConfirming(false);
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}
