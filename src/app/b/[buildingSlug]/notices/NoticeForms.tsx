"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { NoticeDeliveryMethod } from "~/generated/prisma/enums";
import { Button, Field, inputClass, textareaClass } from "~/components/patterns/Button";
import {
  NOTICES,
  NOTICE_TYPES,
  type Answer,
  type NoticeType,
} from "~/lib/primitives/notices";
import {
  closeCampaignAction,
  openCampaignAction,
  recordDeliveryAction,
  recordResponseAction,
  sendCampaignAction,
} from "./actions";

/**
 * The controls.
 *
 * Two of them carry the module. Sending reports what it could not do — the
 * apartments with no address on file — rather than a cheerful count of what it
 * managed, because those are the ones somebody has to walk a copy to. And
 * closing says up front what it is about to create, since converting five
 * silences into five pieces of work on the calendar is a decision, not a tidy-up.
 */

// --- Opening one -----------------------------------------------------------

export function OpenCampaign({
  buildingSlug,
  year: thisYear,
  defaultDueOn,
  defaultRespondBy,
  taken,
}: {
  buildingSlug: string;
  year: number;
  defaultDueOn: string;
  defaultRespondBy: string;
  taken: readonly NoticeType[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  // Every notice stays on the list, with the ones already open for this year
  // marked rather than removed — the year below is editable, and a board
  // catching up on a year they missed needs the notice that is open for this
  // one. The selection starts on the first that is not already open, which is
  // the answer in the common case.
  const available = NOTICE_TYPES.filter((type) => !taken.includes(type));
  const [noticeType, setNoticeType] = useState<NoticeType>(
    available[0] ?? "WINDOW_GUARD",
  );
  const [year, setYear] = useState(String(thisYear));
  const [dueOn, setDueOn] = useState(defaultDueOn);
  const [respondBy, setRespondBy] = useState(defaultRespondBy);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});
    startTransition(async () => {
      const result = await openCampaignAction({
        buildingSlug,
        noticeType,
        year: Number(year),
        dueOn,
        respondBy,
      });
      if (result.ok) {
        setOpen(false);
        router.push(`/b/${buildingSlug}/notices/${result.data.campaignId}`);
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  return (
    <div>
      {error ? (
        <p className="text-stamp mb-2 text-sm" data-testid="open-error">
          {error}
        </p>
      ) : null}

      {!open ? (
        <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
          Open a notice for {thisYear}
        </Button>
      ) : (
        <div className="sheet px-4 py-4">
          <Field
            label="Which notice"
            hint={NOTICES[noticeType].citation}
            error={fieldError["noticeType"]}
          >
            <select
              value={noticeType}
              onChange={(event) => setNoticeType(event.target.value as NoticeType)}
              className={inputClass}
            >
              {NOTICE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {NOTICES[type].title}
                  {taken.includes(type) ? ` — already open for ${thisYear}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <p className="text-ironwork-soft mt-2 text-sm">
            {NOTICES[noticeType].question}
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <Field label="Which year" hint="The notice year, not today's date.">
              <input
                type="number"
                min="2000"
                max="2100"
                value={year}
                onChange={(event) => setYear(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field
              label="Has to go out by"
              hint="From the compliance calendar."
              error={fieldError["dueOn"]}
            >
              <input
                type="date"
                value={dueOn}
                onChange={(event) => setDueOn(event.target.value)}
                className={inputClass}
              />
            </Field>
            <Field
              label="Households reply by"
              hint="Silence after this date is work the building owes."
              error={fieldError["respondBy"]}
            >
              <input
                type="date"
                value={respondBy}
                onChange={(event) => setRespondBy(event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="mt-4 flex gap-2">
            <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
              {pending ? "Opening…" : "Open it"}
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

// --- Sending ---------------------------------------------------------------

export function SendCampaign({
  buildingSlug,
  campaignId,
  alreadySent,
}: {
  buildingSlug: string;
  campaignId: string;
  alreadySent: boolean;
}) {
  const router = useRouter();
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const result = await sendCampaignAction({ buildingSlug, campaignId });
      if (result.ok) {
        const { sent, noAddress, failed } = result.data;
        setSummary(
          [
            sent === 0
              ? "Nothing new went out."
              : `Sent to ${sent} ${sent === 1 ? "household" : "households"}.`,
            noAddress > 0
              ? `${noAddress} ${noAddress === 1 ? "apartment has" : "apartments have"} no address on file — somebody has to take a copy round.`
              : null,
            failed > 0 ? `${failed} could not be delivered.` : null,
          ]
            .filter(Boolean)
            .join(" "),
        );
      } else {
        setError(result.message);
      }
      router.refresh();
    });
  }

  return (
    <div>
      {error ? (
        <p className="text-stamp mb-2 text-sm" data-testid="send-error">
          {error}
        </p>
      ) : null}
      {summary ? (
        <div className="border-complete-line bg-complete-soft mb-3 border-l-2 px-3 py-2">
          <p className="text-ironwork text-sm" data-testid="send-summary">
            {summary}
          </p>
        </div>
      ) : null}

      <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
        {pending ? "Sending…" : alreadySent ? "Send to anyone still missed" : "Send it"}
      </Button>
    </div>
  );
}

// --- A paper copy ----------------------------------------------------------

const METHODS: ReadonlyArray<{ value: NoticeDeliveryMethod; label: string }> = [
  { value: "HAND", label: "By hand, under the door" },
  { value: "MAIL", label: "By post" },
  { value: "POSTED", label: "Posted in the building" },
];

export function RecordDelivery({
  buildingSlug,
  campaignId,
  deliveryId,
  unitLabel,
  today: todayDate,
}: {
  buildingSlug: string;
  campaignId: string;
  deliveryId: string;
  unitLabel: string;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<NoticeDeliveryMethod>("HAND");
  const [sentOn, setSentOn] = useState(todayDate);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const result = await recordDeliveryAction({
        buildingSlug,
        campaignId,
        deliveryId,
        method,
        sentOn,
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
      {error ? <p className="text-stamp mb-1 text-xs">{error}</p> : null}

      {!open ? (
        <Button intent="quiet" size="sm" onClick={() => setOpen(true)}>
          Record how {unitLabel} got it
        </Button>
      ) : (
        <div className="sheet mt-2 px-3 py-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="How">
              <select
                value={method}
                onChange={(event) =>
                  setMethod(event.target.value as NoticeDeliveryMethod)
                }
                className={inputClass}
              >
                {METHODS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="When">
              <input
                type="date"
                value={sentOn}
                onChange={(event) => setSentOn(event.target.value)}
                className={inputClass}
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

// --- The answer ------------------------------------------------------------

export function RecordResponse({
  buildingSlug,
  campaignId,
  deliveryId,
  unitLabel,
  noticeType,
  today: todayDate,
}: {
  buildingSlug: string;
  campaignId: string;
  deliveryId: string;
  unitLabel: string;
  noticeType: NoticeType;
  today: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<Answer>("NO");
  const [note, setNote] = useState("");
  const [respondedOn, setRespondedOn] = useState(todayDate);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const spec = NOTICES[noticeType];

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const result = await recordResponseAction({
        buildingSlug,
        campaignId,
        deliveryId,
        answer,
        note,
        respondedOn,
      });
      if (result.ok) {
        setOpen(false);
        setNote("");
        router.refresh();
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div>
      {error ? (
        <p className="text-stamp mb-1 text-xs" data-testid="response-error">
          {error}
        </p>
      ) : null}

      {!open ? (
        <Button intent="secondary" size="sm" onClick={() => setOpen(true)}>
          Record {unitLabel}&rsquo;s answer
        </Button>
      ) : (
        <div className="sheet mt-2 px-3 py-3">
          <p className="text-ironwork-soft mb-2 text-sm">{spec.question}</p>

          <Field label="They answered">
            <select
              value={answer}
              onChange={(event) => setAnswer(event.target.value as Answer)}
              className={inputClass}
            >
              {(["YES", "NO", "REQUESTED"] as const).map((option) => (
                <option key={option} value={option}>
                  {spec.answers[option]}
                </option>
              ))}
            </select>
          </Field>

          <div className="mt-3">
            <Field label="When">
              <input
                type="date"
                value={respondedOn}
                onChange={(event) => setRespondedOn(event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="mt-3">
            <Field label="Anything they added" hint="Optional, and kept verbatim.">
              <textarea
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                className={textareaClass}
              />
            </Field>
          </div>

          {answer !== "NO" ? (
            <p className="text-ironwork-soft mt-2 text-xs">
              This puts &ldquo;{spec.owed}&rdquo; on the compliance calendar for{" "}
              {unitLabel}.
            </p>
          ) : null}

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

// --- Closing it out --------------------------------------------------------

export function CloseCampaign({
  buildingSlug,
  campaignId,
  willCreate,
  noticeType,
}: {
  buildingSlug: string;
  campaignId: string;
  willCreate: number;
  noticeType: NoticeType;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    startTransition(async () => {
      const result = await closeCampaignAction({ buildingSlug, campaignId });
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
        <p className="text-stamp mb-2 text-sm" data-testid="close-error">
          {error}
        </p>
      ) : null}

      {!open ? (
        <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
          Close it out
        </Button>
      ) : (
        <div className="sheet px-4 py-3">
          <p className="text-ironwork text-sm">
            {willCreate === 0
              ? "Nothing is outstanding. Closing it records that the year is done."
              : `This puts ${willCreate} ${willCreate === 1 ? "apartment" : "apartments"} on the compliance calendar to be seen to.`}
          </p>
          <p className="text-ironwork-soft mt-2 text-sm">
            {NOTICES[noticeType].silenceMeans}
          </p>
          <div className="mt-3 flex gap-2">
            <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
              {pending ? "Closing…" : "Close it and book the work"}
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
              Not yet
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
