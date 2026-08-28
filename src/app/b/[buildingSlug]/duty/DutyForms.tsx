"use client";

import { useState, useTransition } from "react";
import type { DutyKind } from "~/generated/prisma/enums";
import { Button, Field, inputClass, textareaClass } from "~/components/patterns/Button";
import {
  chargeFineAction,
  createRotationAction,
  generateTurnsAction,
  logFineAction,
  setRotationActiveAction,
  swapTurnsAction,
  updateFineAction,
} from "./actions";

/**
 * The rota, and the summons.
 *
 * Two controls carry real weight and both do it by showing an answer rather
 * than asking for one. Setting up a rotation is an ordering exercise, so the
 * order is what you manipulate. Logging a summons never asks whose week it was
 * — it works that out from the date and tells you, because the whole reason
 * this module exists is that nobody remembers.
 */

const KINDS: ReadonlyArray<{ value: DutyKind; label: string }> = [
  { value: "TRASH_SET_OUT", label: "Bins out" },
  { value: "RECYCLING_SET_OUT", label: "Recycling out" },
  { value: "SIDEWALK", label: "Sidewalk sweeping" },
  { value: "OTHER", label: "Something else" },
];

// --- Setting up a rotation -------------------------------------------------

export function CreateRotation({
  buildingSlug,
  units,
  defaultStart,
}: {
  buildingSlug: string;
  units: ReadonlyArray<{ id: string; label: string }>;
  defaultStart: string;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Bins");
  const [kind, setKind] = useState<DutyKind>("TRASH_SET_OUT");
  const [startsOn, setStartsOn] = useState(defaultStart);
  const [periodDays, setPeriodDays] = useState("7");
  const [order, setOrder] = useState<string[]>(units.map((unit) => unit.id));
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function move(index: number, by: number): void {
    const next = [...order];
    const target = index + by;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    setOrder(next);
  }

  function toggle(unitId: string): void {
    setOrder((current) =>
      current.includes(unitId)
        ? current.filter((id) => id !== unitId)
        : [...current, unitId],
    );
  }

  if (!open) {
    return (
      <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
        Set up a rotation
      </Button>
    );
  }

  const labels = new Map(units.map((unit) => [unit.id, unit.label]));

  return (
    <div className="sheet mb-6 px-4 py-4 text-left">
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="What it is" error={fieldError["name"]}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className={inputClass}
            placeholder="Bins"
          />
        </Field>

        <Field label="Kind">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as DutyKind)}
            className={inputClass}
          >
            {KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="First turn starts" error={fieldError["startsOn"]}>
          <input
            type="date"
            value={startsOn}
            onChange={(event) => setStartsOn(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Days per turn" error={fieldError["periodDays"]}>
          <input
            inputMode="numeric"
            value={periodDays}
            onChange={(event) => setPeriodDays(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-4">
        <p className="eyebrow mb-2">The order turns come round in</p>
        {fieldError["unitOrder"] ? (
          <p className="text-stamp mb-2 text-xs">{fieldError["unitOrder"]}</p>
        ) : null}

        <ol className="mb-3 space-y-1.5">
          {order.map((unitId, index) => (
            <li key={unitId} className="flex items-center gap-2">
              <span className="text-ironwork-faint w-6 shrink-0 text-right font-mono text-xs">
                {index + 1}.
              </span>
              <span className="text-ironwork w-20 shrink-0 font-mono text-xs">
                {labels.get(unitId)}
              </span>
              <Button
                size="sm"
                intent="quiet"
                aria-label={`Move ${labels.get(unitId)} earlier`}
                disabled={index === 0}
                onClick={() => move(index, -1)}
              >
                ↑
              </Button>
              <Button
                size="sm"
                intent="quiet"
                aria-label={`Move ${labels.get(unitId)} later`}
                disabled={index === order.length - 1}
                onClick={() => move(index, 1)}
              >
                ↓
              </Button>
              <Button size="sm" intent="quiet" onClick={() => toggle(unitId)}>
                Remove
              </Button>
            </li>
          ))}
        </ol>

        {units.some((unit) => !order.includes(unit.id)) ? (
          <div className="flex flex-wrap gap-2">
            <span className="text-ironwork-faint font-mono text-[0.6875rem]">
              Not in the rotation:
            </span>
            {units
              .filter((unit) => !order.includes(unit.id))
              .map((unit) => (
                <Button
                  key={unit.id}
                  size="sm"
                  intent="quiet"
                  onClick={() => toggle(unit.id)}
                >
                  Add {unit.label}
                </Button>
              ))}
          </div>
        ) : null}
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
              const result = await createRotationAction({
                buildingSlug,
                name,
                kind,
                unitOrder: order,
                startsOn,
                periodDays: Number(periodDays || 7),
              });
              if (result.ok) setOpen(false);
              else {
                setError(result.message);
                setFieldError(result.fields ?? {});
              }
            })
          }
        >
          {pending ? "Setting up…" : "Set it up"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// --- Generating turns ------------------------------------------------------

export function RotationControls({
  buildingSlug,
  rotationId,
  active,
}: {
  buildingSlug: string;
  rotationId: string;
  active: boolean;
}) {
  const [count, setCount] = useState("12");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div>
      {error ? (
        <p role="alert" className="text-stamp mb-2 text-sm">
          {error}
        </p>
      ) : null}
      {note ? <p className="text-ironwork-soft mb-2 text-sm">{note}</p> : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-28">
          <Field label="Turns to add">
            <input
              inputMode="numeric"
              value={count}
              onChange={(event) => setCount(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <Button
          size="sm"
          disabled={pending || !active}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              setNote(null);
              const result = await generateTurnsAction({
                buildingSlug,
                rotationId,
                count: Number(count || 12),
              });
              if (result.ok) {
                setNote(
                  result.data.created === 0
                    ? "Already generated that far ahead."
                    : `${result.data.created} turns added, through ${result.data.through}.`,
                );
              } else setError(result.message);
            })
          }
        >
          {pending ? "Adding…" : "Extend the rota"}
        </Button>

        <Button
          size="sm"
          intent="quiet"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              setError(null);
              const result = await setRotationActiveAction({
                buildingSlug,
                rotationId,
                active: !active,
              });
              if (!result.ok) setError(result.message);
            })
          }
        >
          {active ? "Pause it" : "Resume it"}
        </Button>
      </div>
    </div>
  );
}

// --- Swapping --------------------------------------------------------------

export function SwapTurns({
  buildingSlug,
  turns,
}: {
  buildingSlug: string;
  turns: ReadonlyArray<{ id: string; label: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [mine, setMine] = useState(turns[0]?.id ?? "");
  const [theirs, setTheirs] = useState(turns[1]?.id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (turns.length < 2) return null;

  if (!open) {
    return (
      <div>
        {error ? (
          <p role="alert" className="text-stamp mb-2 text-sm">
            {error}
          </p>
        ) : null}
        <Button size="sm" onClick={() => setOpen(true)}>
          Swap two turns
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
        Both apartments keep their place in the rota — only these two weeks trade. A
        summons for either week will name whoever ends up with it.
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="This turn">
          <select
            value={mine}
            onChange={(event) => setMine(event.target.value)}
            className={inputClass}
          >
            {turns.map((turn) => (
              <option key={turn.id} value={turn.id}>
                {turn.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Trades with">
          <select
            value={theirs}
            onChange={(event) => setTheirs(event.target.value)}
            className={inputClass}
          >
            {turns.map((turn) => (
              <option key={turn.id} value={turn.id}>
                {turn.label}
              </option>
            ))}
          </select>
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
              const result = await swapTurnsAction({
                buildingSlug,
                assignmentId: mine,
                withAssignmentId: theirs,
              });
              if (result.ok) setOpen(false);
              else setError(result.message);
            })
          }
        >
          {pending ? "Swapping…" : "Swap them"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// --- Logging a summons -----------------------------------------------------

/**
 * The picker's value for "this was nobody's turn's fault". Not a uuid, so it
 * cannot collide with a rota id, and explicit so that "nothing chosen yet" and
 * "chosen, and the answer is nobody" stay distinguishable — the first must not
 * silently log a summons against the building.
 */
const NOT_A_ROTA = "not-a-rota";

/**
 * Logging a summons.
 *
 * The rota picker appears only where there is something to pick between. A
 * building with one rotation has nothing to disambiguate — the date settles it
 * — and asking anyway would turn the module's best property into a chore. With
 * two, the question is unavoidable: bins and recycling run different weeks and
 * are frequently different apartments, and only the summons says which one it
 * is about.
 */
export function LogFine({
  buildingSlug,
  defaultIssuedOn,
  rotations,
}: {
  buildingSlug: string;
  defaultIssuedOn: string;
  /** Every rota, paused ones included — a summons can predate a pause. */
  rotations: Array<{ id: string; name: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [ticketNumber, setTicketNumber] = useState("");
  const [issuedOn, setIssuedOn] = useState(defaultIssuedOn);
  const [violation, setViolation] = useState("");
  const [amount, setAmount] = useState("");
  const [hearingOn, setHearingOn] = useState("");
  const [note, setNote] = useState("");
  // "" means nothing chosen; NOT_A_ROTA means chosen, and the answer is nobody.
  const [rotationId, setRotationId] = useState("");
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
          Log a summons
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
        Whose week it was is worked out from the date on the summons, so there is
        nothing to remember and nothing to argue about.
        {rotations.length > 1
          ? " Say which rota it is about, though — more than one runs here, and they are different weeks."
          : ""}
      </p>

      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Summons number" error={fieldError["ticketNumber"]}>
          <input
            value={ticketNumber}
            onChange={(event) => setTicketNumber(event.target.value)}
            className={inputClass}
            placeholder="0093441882"
          />
        </Field>

        <Field label="Issued" error={fieldError["issuedOn"]}>
          <input
            type="date"
            value={issuedOn}
            onChange={(event) => setIssuedOn(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Amount" error={fieldError["amountCents"]}>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
            placeholder="100.00"
          />
        </Field>

        <Field
          label="Answer by"
          hint="The date printed on the summons, if it has one."
          error={fieldError["hearingOn"]}
        >
          <input
            type="date"
            value={hearingOn}
            onChange={(event) => setHearingOn(event.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="sm:col-span-4">
          <Field label="Violation" error={fieldError["violation"]}>
            <input
              value={violation}
              onChange={(event) => setViolation(event.target.value)}
              className={inputClass}
              placeholder="Receptacle set out before 6pm"
            />
          </Field>
        </div>
      </div>

      {rotations.length > 1 ? (
        <div className="mt-3 max-w-sm">
          <Field
            label="Which rota?"
            hint="The date says whose turn it was. Only the summons says which rota."
            error={fieldError["rotationId"]}
          >
            <select
              value={rotationId}
              onChange={(event) => setRotationId(event.target.value)}
              className={inputClass}
            >
              <option value="">Choose…</option>
              {rotations.map((rotation) => (
                <option key={rotation.id} value={rotation.id}>
                  {rotation.name}
                </option>
              ))}
              <option value={NOT_A_ROTA}>Not a rota&rsquo;s fault</option>
            </select>
          </Field>
        </div>
      ) : null}

      <div className="mt-3">
        <Field label="Note">
          <textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            className={textareaClass}
            placeholder="Photographed by the inspector at 5.40pm."
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
              const result = await logFineAction({
                buildingSlug,
                ticketNumber,
                issuedOn,
                violation,
                amount,
                hearingOn: hearingOn || null,
                note: note || null,
                // Omitted entirely where there is one rota: the write path
                // derives it, and only refuses if it turns out to be
                // ambiguous after all.
                ...(rotations.length > 1 && rotationId
                  ? { rotationId: rotationId === NOT_A_ROTA ? null : rotationId }
                  : {}),
              });
              if (result.ok) {
                setOpen(false);
                setTicketNumber("");
                setViolation("");
                setAmount("");
                setNote("");
                setRotationId("");
              } else {
                setError(result.message);
                setFieldError(result.fields ?? {});
              }
            })
          }
        >
          {pending ? "Logging…" : "Log it"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// --- Answering it ----------------------------------------------------------

export function AnswerFine({
  buildingSlug,
  fineId,
  defaultDate,
}: {
  buildingSlug: string;
  fineId: string;
  defaultDate: string;
}) {
  const [date, setDate] = useState(defaultDate);
  const [outcome, setOutcome] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function answer(how: "paid" | "contested"): void {
    setError(null);
    setFieldError({});
    startTransition(async () => {
      const result = await updateFineAction({
        buildingSlug,
        fineId,
        ...(how === "paid" ? { paidOn: date } : { contestedOn: date }),
        outcome: outcome || null,
      });
      if (!result.ok) {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  return (
    <div className="sheet px-4 py-4">
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="On" error={fieldError["paidOn"] ?? fieldError["contestedOn"]}>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="What happened">
            <input
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              className={inputClass}
              placeholder="Requested a hearing at OATH."
            />
          </Field>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          intent="primary"
          size="sm"
          disabled={pending}
          onClick={() => answer("contested")}
        >
          {pending ? "Recording…" : "Record it as contested"}
        </Button>
        <Button size="sm" disabled={pending} onClick={() => answer("paid")}>
          Record it as paid
        </Button>
      </div>
    </div>
  );
}

// --- Recharging ------------------------------------------------------------

export function ChargeFine({
  buildingSlug,
  fineId,
  unitLabel,
  defaultAmount,
  defaultDueOn,
}: {
  buildingSlug: string;
  fineId: string;
  unitLabel: string;
  defaultAmount: string;
  defaultDueOn: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [amount, setAmount] = useState(defaultAmount);
  const [dueOn, setDueOn] = useState(defaultDueOn);
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
          Recharge it to {unitLabel}
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
        <Field label="Amount">
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Due">
          <input
            type="date"
            value={dueOn}
            onChange={(event) => setDueOn(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      {confirming ? (
        <div className="border-stamp bg-stamp-soft mt-4 border-l-2 px-3 py-2">
          <p className="text-ironwork text-sm">
            This puts {amount || "—"} on {unitLabel}&rsquo;s ledger because the rota
            says it was their week. Correcting it afterwards means a reversing entry,
            not an edit.
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
                const result = await chargeFineAction({
                  buildingSlug,
                  fineId,
                  dueOn,
                  amount: amount || null,
                });
                if (result.ok) {
                  setOpen(false);
                  setConfirming(false);
                } else {
                  setError(result.message);
                  setConfirming(false);
                }
              })
            }
          >
            {pending ? "Charging…" : `Yes, charge ${unitLabel}`}
          </Button>
        ) : (
          <Button intent="primary" size="sm" onClick={() => setConfirming(true)}>
            Charge it
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
