"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ResourceKind } from "~/generated/prisma/enums";
import { Button, Field, inputClass, textareaClass } from "~/components/patterns/Button";
import type { PrerequisiteType } from "~/lib/primitives/prerequisites";
import {
  addResourceAction,
  cancelBookingAction,
  confirmBookingAction,
  recordDepositAction,
  requestBookingAction,
  retireResourceAction,
  returnDepositAction,
} from "./actions";

/**
 * The controls.
 *
 * The request form is the one worth reading. It never asks for a time — it
 * offers the day's slots, with the taken ones already spoken for, and posts a
 * slot index. A booking that starts at ten past nine is not a validation error
 * here, it is something the form has no way to express.
 *
 * The confirm button is the module's other half. It runs the conditions rather
 * than asserting them, and when they do not hold it says which ones and stays
 * put, because a shareholder who is refused needs the list, not a "no".
 */

// --- Asking for a slot -----------------------------------------------------

export interface SlotOption {
  readonly index: number;
  readonly label: string;
  readonly takenBy: string | null;
  readonly gone: boolean;
}

export function RequestBooking({
  buildingSlug,
  resourceId,
  resourceName,
  date,
  slots,
  units,
  defaultUnitId,
}: {
  buildingSlug: string;
  resourceId: string;
  resourceName: string;
  date: string;
  slots: readonly SlotOption[];
  units: ReadonlyArray<{ id: string; label: string }>;
  defaultUnitId: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unitId, setUnitId] = useState(defaultUnitId ?? units[0]?.id ?? "");
  const [slotIndex, setSlotIndex] = useState<string>("");
  const [span, setSpan] = useState("1");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const free = slots.filter((slot) => !slot.takenBy && !slot.gone);

  function submit(): void {
    setError(null);
    setFieldError({});
    startTransition(async () => {
      const result = await requestBookingAction({
        buildingSlug,
        resourceId,
        unitId,
        date,
        slotIndex: Number(slotIndex),
        slots: Number(span),
        note,
      });

      if (result.ok) {
        setOpen(false);
        setNote("");
        setSlotIndex("");
        router.push(`/b/${buildingSlug}/bookings/${result.data.bookingId}`);
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  if (free.length === 0) {
    return (
      <p className="text-ironwork-soft mt-3 text-sm">
        Nothing free on {resourceName} that day.
      </p>
    );
  }

  return (
    <div className="mt-3">
      {error ? (
        <p className="text-stamp mb-3 text-sm" data-testid="request-error">
          {error}
        </p>
      ) : null}

      {!open ? (
        <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
          Ask for a slot
        </Button>
      ) : (
        <div className="sheet px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Which slot" error={fieldError["slotIndex"]}>
              <select
                value={slotIndex}
                onChange={(event) => setSlotIndex(event.target.value)}
                className={inputClass}
              >
                <option value="">Pick one</option>
                {free.map((slot) => (
                  <option key={slot.index} value={slot.index}>
                    {slot.label}
                  </option>
                ))}
              </select>
            </Field>

            <Field
              label="How long"
              hint="Consecutive slots. A big move often needs two."
            >
              <select
                value={span}
                onChange={(event) => setSpan(event.target.value)}
                className={inputClass}
              >
                <option value="1">One slot</option>
                <option value="2">Two slots</option>
                <option value="3">Three slots</option>
              </select>
            </Field>

            {units.length > 1 ? (
              <Field label="Apartment" error={fieldError["unitId"]}>
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
            ) : null}
          </div>

          <div className="mt-3">
            <Field label="What for" hint="So the board knows what to expect.">
              <textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={textareaClass}
                placeholder="Move-in. Vanguard are doing it."
              />
            </Field>
          </div>

          <div className="mt-4 flex gap-2">
            <Button
              intent="primary"
              size="sm"
              disabled={pending || slotIndex === ""}
              onClick={submit}
            >
              {pending ? "Holding…" : "Hold it"}
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Confirming ------------------------------------------------------------

export function ConfirmBooking({
  buildingSlug,
  bookingId,
}: {
  buildingSlug: string;
  bookingId: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const result = await confirmBookingAction({ buildingSlug, bookingId });
      // Refreshed either way. A refused confirmation still writes down what it
      // checked, and that record is what the page is showing.
      if (!result.ok) setError(result.message);
      router.refresh();
    });
  }

  return (
    <div>
      {error ? (
        <p className="text-stamp mb-3 text-sm" data-testid="confirm-error">
          {error}
        </p>
      ) : null}
      <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
        {pending ? "Checking…" : "Check and confirm"}
      </Button>
    </div>
  );
}

// --- Giving it up ----------------------------------------------------------

export function CancelBooking({
  buildingSlug,
  bookingId,
  own,
}: {
  buildingSlug: string;
  bookingId: string;
  own: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const result = await cancelBookingAction({ buildingSlug, bookingId, reason });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div>
      {error ? (
        <p className="text-stamp mb-2 text-sm" data-testid="cancel-error">
          {error}
        </p>
      ) : null}

      {!open ? (
        <Button intent="destructive" size="sm" onClick={() => setOpen(true)}>
          {own ? "Give up the slot" : "Cancel this booking"}
        </Button>
      ) : (
        <div className="sheet px-4 py-3">
          <Field
            label="Why"
            hint={
              own
                ? "Optional — it goes on the record either way."
                : "Say why. Somebody has arranged their day around this."
            }
          >
            <input
              type="text"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className={inputClass}
              placeholder="Elevator out of service"
            />
          </Field>
          <div className="mt-3 flex gap-2">
            <Button intent="destructive" size="sm" disabled={pending} onClick={submit}>
              {pending ? "Releasing…" : "Release it"}
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
              Keep it
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- The deposit -----------------------------------------------------------

export function RecordDeposit({
  buildingSlug,
  bookingId,
  today: todayDate,
  suggestedAmount,
}: {
  buildingSlug: string;
  bookingId: string;
  today: string;
  suggestedAmount: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(suggestedAmount);
  const [receivedOn, setReceivedOn] = useState(todayDate);
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});
    startTransition(async () => {
      const result = await recordDepositAction({
        buildingSlug,
        bookingId,
        amount,
        receivedOn,
        reference,
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  return (
    <div>
      {error ? (
        <p className="text-stamp mb-2 text-sm" data-testid="deposit-error">
          {error}
        </p>
      ) : null}

      {!open ? (
        <Button intent="secondary" size="sm" onClick={() => setOpen(true)}>
          Record the deposit
        </Button>
      ) : (
        <div className="sheet px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Amount" error={fieldError["amount"]}>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Received" error={fieldError["receivedOn"]}>
              <input
                type="date"
                value={receivedOn}
                onChange={(event) => setReceivedOn(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Reference" hint="Cheque number, or how it arrived.">
              <input
                type="text"
                value={reference}
                onChange={(event) => setReference(event.target.value)}
                className={inputClass}
                placeholder="chq 1043"
              />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
              {pending ? "Recording…" : "Record it"}
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReturnDeposit({
  buildingSlug,
  bookingId,
  today: todayDate,
}: {
  buildingSlug: string;
  bookingId: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [returnedOn, setReturnedOn] = useState(todayDate);
  const [withheld, setWithheld] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});
    startTransition(async () => {
      const result = await returnDepositAction({
        buildingSlug,
        bookingId,
        returnedOn,
        withheld,
        note,
      });
      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  return (
    <div>
      {error ? (
        <p className="text-stamp mb-2 text-sm" data-testid="return-error">
          {error}
        </p>
      ) : null}

      {!open ? (
        <Button intent="secondary" size="sm" onClick={() => setOpen(true)}>
          Return the deposit
        </Button>
      ) : (
        <div className="sheet px-4 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Returned" error={fieldError["returnedOn"]}>
              <input
                type="date"
                value={returnedOn}
                onChange={(event) => setReturnedOn(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field
              label="Kept back"
              hint="Blank if all of it goes back."
              error={fieldError["withheld"]}
            >
              <input
                type="text"
                inputMode="decimal"
                value={withheld}
                onChange={(event) => setWithheld(event.target.value)}
                className={inputClass}
                placeholder="0"
              />
            </Field>
          </div>
          <div className="mt-3">
            <Field
              label="What for"
              hint="Required if anything is kept. A deduction nobody explained is the one that gets disputed."
            >
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={inputClass}
                placeholder="Gouge in the lobby plaster"
              />
            </Field>
          </div>
          <div className="mt-3 flex gap-2">
            <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
              {pending ? "Recording…" : "Record the return"}
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- What the building schedules -------------------------------------------

const KINDS: ReadonlyArray<{ value: ResourceKind; label: string }> = [
  { value: "FREIGHT_ELEVATOR", label: "Freight elevator" },
  { value: "ROOF_DECK", label: "Roof deck" },
  { value: "COMMON_ROOM", label: "Common room" },
  { value: "LAUNDRY", label: "Laundry" },
  { value: "COURTYARD", label: "Courtyard" },
  { value: "STORAGE", label: "Storage" },
];

/**
 * Every condition the registry knows how to check.
 *
 * Listed from the registry's own vocabulary rather than typed out per
 * resource, which is the point: the roof deck picks from the same set the
 * freight elevator uses, and adding a checker adds an option here.
 */
const CONDITIONS: ReadonlyArray<{
  type: PrerequisiteType;
  label: string;
  amount?: "deposit" | "coverage";
}> = [
  { type: "DEPOSIT_PAID", label: "A deposit recorded", amount: "deposit" },
  { type: "VALID_COI", label: "Insurance valid on the day", amount: "coverage" },
  { type: "NO_ARREARS", label: "Maintenance up to date" },
  { type: "APPROVED_ALTERATION", label: "An approved alteration" },
];

export function AddResource({ buildingSlug }: { buildingSlug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("Roof deck");
  const [kind, setKind] = useState<ResourceKind>("ROOF_DECK");
  const [slotHours, setSlotHours] = useState("3");
  const [opensHour, setOpensHour] = useState("10");
  const [closesHour, setClosesHour] = useState("22");
  const [chosen, setChosen] = useState<Set<PrerequisiteType>>(new Set());
  const [deposit, setDeposit] = useState("100");
  const [coverage, setCoverage] = useState("1000000");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(type: PrerequisiteType): void {
    const next = new Set(chosen);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setChosen(next);
  }

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const prerequisites = CONDITIONS.filter((condition) =>
        chosen.has(condition.type),
      ).map((condition) => ({
        type: condition.type,
        config:
          condition.amount === "deposit"
            ? { amountCents: Math.round(Number(deposit) * 100) }
            : condition.amount === "coverage"
              ? {
                  minimumCoverageCents: Math.round(Number(coverage) * 100),
                  requireAdditionalInsured: true,
                }
              : {},
      }));

      const result = await addResourceAction({
        buildingSlug,
        name,
        kind,
        slotMinutes: Math.round(Number(slotHours) * 60),
        opensMinute: Math.round(Number(opensHour) * 60),
        closesMinute: Math.round(Number(closesHour) * 60),
        prerequisites,
      });

      if (result.ok) {
        setOpen(false);
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div>
      {error ? (
        <p className="text-stamp mb-2 text-sm" data-testid="resource-error">
          {error}
        </p>
      ) : null}

      {!open ? (
        <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
          Add something bookable
        </Button>
      ) : (
        <div className="sheet px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Name" hint="What people call it.">
              <input
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Kind">
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as ResourceKind)}
                className={inputClass}
              >
                {KINDS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Slot length" hint="Hours.">
              <input
                type="number"
                min="1"
                max="12"
                value={slotHours}
                onChange={(event) => setSlotHours(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Opens" hint="Hour of the day.">
              <input
                type="number"
                min="0"
                max="23"
                value={opensHour}
                onChange={(event) => setOpensHour(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Closes" hint="Hour of the day.">
              <input
                type="number"
                min="1"
                max="24"
                value={closesHour}
                onChange={(event) => setClosesHour(event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <p className="eyebrow mt-4 mb-1.5">Before it confirms</p>
          <ul className="space-y-1.5">
            {CONDITIONS.map((condition) => (
              <li key={condition.type}>
                <label className="text-ironwork flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={chosen.has(condition.type)}
                    onChange={() => toggle(condition.type)}
                  />
                  {condition.label}
                </label>
              </li>
            ))}
          </ul>

          {chosen.has("DEPOSIT_PAID") ? (
            <div className="mt-3">
              <Field label="Deposit" hint="Dollars.">
                <input
                  type="text"
                  inputMode="decimal"
                  value={deposit}
                  onChange={(event) => setDeposit(event.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          ) : null}

          {chosen.has("VALID_COI") ? (
            <div className="mt-3">
              <Field label="Minimum coverage" hint="Dollars.">
                <input
                  type="text"
                  inputMode="decimal"
                  value={coverage}
                  onChange={(event) => setCoverage(event.target.value)}
                  className={inputClass}
                />
              </Field>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
              {pending ? "Adding…" : "Add it"}
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function RetireResource({
  buildingSlug,
  resourceId,
  name,
}: {
  buildingSlug: string;
  resourceId: string;
  name: string;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const result = await retireResourceAction({ buildingSlug, resourceId });
      if (result.ok) router.refresh();
      else setError(result.message);
    });
  }

  return (
    <div>
      {error ? <p className="text-stamp mb-1 text-xs">{error}</p> : null}
      <Button intent="quiet" size="sm" disabled={pending} onClick={submit}>
        {pending ? "Removing…" : `Take ${name} off the list`}
      </Button>
    </div>
  );
}
