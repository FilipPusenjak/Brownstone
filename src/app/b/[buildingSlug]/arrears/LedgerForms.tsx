"use client";

import { useState, useTransition } from "react";
import type { ChargeKind, PaymentMethod } from "~/generated/prisma/enums";
import { Button, Field, inputClass } from "~/components/patterns/Button";
import {
  postChargeAction,
  recordPaymentAction,
  reverseChargeAction,
  reversePaymentAction,
} from "./actions";

/**
 * Posting a charge, and recording a payment.
 *
 * Two separate forms rather than one with a toggle. "The building charged 4F
 * $900" and "4F paid $900" are opposite facts, and a form where the difference
 * is a dropdown is a form where the wrong one gets submitted eventually.
 */

const CHARGE_KINDS: ReadonlyArray<{ value: ChargeKind; label: string }> = [
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "ASSESSMENT", label: "Assessment" },
  { value: "LATE_FEE", label: "Late fee" },
  { value: "SUBLET_FEE", label: "Sublet fee" },
  { value: "MOVE_FEE", label: "Move fee" },
  { value: "DEPOSIT", label: "Deposit" },
  { value: "LEGAL_FEE", label: "Legal fee" },
  { value: "OTHER", label: "Something else" },
];

const METHODS: ReadonlyArray<{ value: PaymentMethod; label: string }> = [
  { value: "CHECK", label: "Cheque" },
  { value: "ACH_MANUAL", label: "Bank transfer" },
  { value: "CASH", label: "Cash" },
  { value: "MONEY_ORDER", label: "Money order" },
  { value: "OTHER", label: "Something else" },
];

export function ChargeForm({
  buildingSlug,
  unitId,
  unitLabel,
  today,
}: {
  buildingSlug: string;
  unitId: string;
  unitLabel: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ChargeKind>("MAINTENANCE");
  const [amount, setAmount] = useState("");
  const [dueOn, setDueOn] = useState(today);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});

    startTransition(async () => {
      const result = await postChargeAction({
        buildingSlug,
        unitId,
        kind,
        amount,
        dueOn,
        memo: memo || null,
      });

      if (result.ok) {
        setOpen(false);
        setAmount("");
        setMemo("");
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Post a charge
      </Button>
    );
  }

  return (
    <div className="sheet px-4 py-4">
      <p className="eyebrow mb-3">Charge {unitLabel}</p>

      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="What for">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as ChargeKind)}
            className={inputClass}
          >
            {CHARGE_KINDS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Amount" error={fieldError["amount"] ?? fieldError["amountCents"]}>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
            placeholder="900.00"
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

      <div className="mt-3">
        <Field
          label="Memo"
          hint="What this is for. Optional, but future boards read these."
        >
          <input
            value={memo}
            onChange={(event) => setMemo(event.target.value)}
            className={inputClass}
            placeholder="Freight elevator, 14 March move"
          />
        </Field>
      </div>

      <div className="mt-4 flex gap-2">
        <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Posting…" : "Post the charge"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function PaymentForm({
  buildingSlug,
  unitId,
  unitLabel,
  today,
}: {
  buildingSlug: string;
  unitId: string;
  unitLabel: string;
  today: string;
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState(today);
  const [method, setMethod] = useState<PaymentMethod>("CHECK");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});

    startTransition(async () => {
      const result = await recordPaymentAction({
        buildingSlug,
        unitId,
        amount,
        receivedOn,
        method,
        reference: reference || null,
      });

      if (result.ok) {
        setOpen(false);
        setAmount("");
        setReference("");
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  if (!open) {
    return (
      <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
        Record a payment
      </Button>
    );
  }

  return (
    <div className="sheet px-4 py-4">
      <p className="eyebrow mb-3">Payment from {unitLabel}</p>

      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Amount" error={fieldError["amount"] ?? fieldError["amountCents"]}>
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={inputClass}
            placeholder="900.00"
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

        <Field label="How">
          <select
            value={method}
            onChange={(event) => setMethod(event.target.value as PaymentMethod)}
            className={inputClass}
          >
            {METHODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Reference" hint="Cheque number, or the transfer reference.">
          <input
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            className={inputClass}
            placeholder="1214"
          />
        </Field>
      </div>

      <p className="text-ironwork-faint mt-3 text-xs leading-relaxed">
        This records that money arrived. Co-operator never collects it — there is no
        payment processor here, and the schema has nowhere to put a card number.
      </p>

      <div className="mt-4 flex gap-2">
        <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Recording…" : "Record the payment"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/**
 * Reversing an entry.
 *
 * Deliberately not a delete, and worded so nobody expects one: the original
 * stays on the ledger and a second, negative entry is written against it. The
 * reason is required because "why is there a -$900 here" is a question someone
 * will ask years from now.
 */
export function ReverseButton({
  buildingSlug,
  entryId,
  kind,
}: {
  buildingSlug: string;
  entryId: string;
  kind: "charge" | "payment";
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const result =
        kind === "charge"
          ? await reverseChargeAction({ buildingSlug, chargeId: entryId, reason })
          : await reversePaymentAction({ buildingSlug, paymentId: entryId, reason });

      if (result.ok) {
        setOpen(false);
        setReason("");
      } else {
        setError(result.message);
      }
    });
  }

  if (!open) {
    return (
      <Button intent="quiet" size="sm" onClick={() => setOpen(true)}>
        Reverse
      </Button>
    );
  }

  return (
    <div className="sheet mt-2 px-3 py-3">
      {error ? (
        <p role="alert" className="text-stamp mb-2 text-xs">
          {error}
        </p>
      ) : null}

      <Field
        label="Why is this being reversed?"
        hint={
          kind === "charge"
            ? "The original stays on the ledger with this entry against it."
            : "A returned cheque, or one recorded twice."
        }
      >
        <input
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          className={inputClass}
          placeholder={
            kind === "charge"
              ? "Charged in error — wrong apartment"
              : "Cheque returned unpaid"
          }
        />
      </Field>

      <div className="mt-3 flex gap-2">
        <Button intent="destructive" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Reversing…" : "Reverse it"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Keep it
        </Button>
      </div>
    </div>
  );
}
