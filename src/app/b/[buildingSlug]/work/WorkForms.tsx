"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { WorkStatus } from "~/generated/prisma/enums";
import { Button, Field, inputClass, textareaClass } from "~/components/patterns/Button";
import { createWorkAction, raiseAssessmentAction, updateWorkAction } from "./actions";

const STATUSES: ReadonlyArray<{ value: WorkStatus; label: string }> = [
  { value: "PROPOSED", label: "Proposed" },
  { value: "APPROVED", label: "Approved" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "COMPLETE", label: "Complete" },
  { value: "CANCELLED", label: "Cancelled" },
];

/** Recording a piece of work. Any officer may do this — it costs nobody anything. */
export function AddWorkForm({
  buildingSlug,
  obligationId,
  label = "Add building work",
}: {
  buildingSlug: string;
  obligationId?: string;
  label?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const [estimate, setEstimate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});

    startTransition(async () => {
      const result = await createWorkAction({
        buildingSlug,
        title,
        detail: detail || null,
        estimate: estimate || null,
        obligationId: obligationId ?? null,
      });

      if (result.ok) {
        setOpen(false);
        setTitle("");
        setDetail("");
        setEstimate("");
        router.push(`/b/${buildingSlug}/work/${result.data.workId}`);
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  if (!open) {
    return (
      <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
        {label}
      </Button>
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
        <div className="sm:col-span-2">
          <Field label="What needs doing" error={fieldError["title"]}>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={inputClass}
              placeholder="Replace the roof"
            />
          </Field>
        </div>

        <Field
          label="Estimated cost"
          hint="Optional until the quote arrives."
          error={fieldError["estimate"]}
        >
          <input
            inputMode="decimal"
            value={estimate}
            onChange={(event) => setEstimate(event.target.value)}
            className={inputClass}
            placeholder="42,000.00"
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Detail" hint="Scope, the contractor, what the board decided.">
          <textarea
            rows={3}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
            className={textareaClass}
            placeholder="Two quotes received. Board voted 4–1 at the March meeting to proceed with Brennan Roofing."
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

/** Changing the estimate or where the work has got to. */
export function WorkControls({
  buildingSlug,
  workId,
  status,
  estimateLocked,
}: {
  buildingSlug: string;
  workId: string;
  status: WorkStatus;
  estimateLocked: boolean;
}) {
  const [estimate, setEstimate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(next: { estimate?: string; status?: WorkStatus }): void {
    setError(null);
    startTransition(async () => {
      const result = await updateWorkAction({
        buildingSlug,
        workId,
        ...(next.estimate !== undefined ? { estimate: next.estimate } : {}),
        ...(next.status !== undefined ? { status: next.status } : {}),
      });
      if (result.ok) setEstimate("");
      else setError(result.message);
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3">
      {error ? (
        <p role="alert" className="text-stamp basis-full text-sm">
          {error}
        </p>
      ) : null}

      <div className="w-40">
        <Field label="Where it's up to">
          <select
            value={status}
            disabled={pending}
            onChange={(event) => save({ status: event.target.value as WorkStatus })}
            className={inputClass}
          >
            {STATUSES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {estimateLocked ? null : (
        <>
          <div className="w-40">
            <Field label="Update the estimate">
              <input
                inputMode="decimal"
                value={estimate}
                onChange={(event) => setEstimate(event.target.value)}
                className={inputClass}
                placeholder="42,000.00"
              />
            </Field>
          </div>
          <Button
            size="sm"
            disabled={pending || estimate.trim() === ""}
            onClick={() => save({ estimate })}
          >
            {pending ? "Saving…" : "Save"}
          </Button>
        </>
      )}
    </div>
  );
}

/**
 * Raising the assessment.
 *
 * The confirm step is not ceremony. This is the moment an estimate becomes debt
 * on twelve neighbours' accounts, it cannot be done twice, and undoing it means
 * reversing a charge per apartment — so the button says what it is about to do
 * and asks once more.
 */
export function RaiseAssessment({
  buildingSlug,
  workId,
  defaultDueOn,
  defaultTotal,
  apartments,
}: {
  buildingSlug: string;
  workId: string;
  defaultDueOn: string;
  defaultTotal: string;
  apartments: number;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [dueOn, setDueOn] = useState(defaultDueOn);
  const [total, setTotal] = useState(defaultTotal);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function raise(): void {
    setError(null);
    setFieldError({});

    startTransition(async () => {
      const result = await raiseAssessmentAction({
        buildingSlug,
        workId,
        dueOn,
        total: total || null,
      });

      if (result.ok) {
        setOpen(false);
        setConfirming(false);
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
        setConfirming(false);
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
        <Button intent="primary" onClick={() => setOpen(true)}>
          Raise this assessment
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
        <Field
          label="Amount to raise"
          hint="Defaults to the estimate."
          error={fieldError["total"]}
        >
          <input
            inputMode="decimal"
            value={total}
            onChange={(event) => setTotal(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field
          label="Due date"
          hint="Shares are read as of this date."
          error={fieldError["dueOn"]}
        >
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
            This posts a charge to all {apartments} apartments, due {dueOn}. It
            can&rsquo;t be done twice, and undoing it means reversing each charge.
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex gap-2">
        {confirming ? (
          <Button intent="primary" size="sm" disabled={pending} onClick={raise}>
            {pending ? "Raising…" : "Yes, charge every apartment"}
          </Button>
        ) : (
          <Button intent="primary" size="sm" onClick={() => setConfirming(true)}>
            Raise it
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
