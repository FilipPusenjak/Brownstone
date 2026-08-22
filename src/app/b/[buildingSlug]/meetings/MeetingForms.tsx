"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { AttendanceMode, MeetingType, VoteChoice } from "~/generated/prisma/enums";
import { Button, Field, inputClass, textareaClass } from "~/components/patterns/Button";
import {
  adoptMinutesAction,
  clearAttendanceAction,
  grantProxyAction,
  recordAttendanceAction,
  recordResolutionAction,
  revokeProxyAction,
  saveMinutesAction,
  scheduleMeetingAction,
  updateMeetingAction,
} from "./actions";

/**
 * The interface for a meeting.
 *
 * Nobody votes in a browser. Everything here is a secretary writing down what
 * happened in a room, so the controls are shaped like the paper they replace: a
 * roster you tick as people arrive, a proxy form, a motion with a tally beside
 * it, and minutes that stop being editable once the board adopts them.
 */

const MEETING_TYPES: ReadonlyArray<{ value: MeetingType; label: string }> = [
  { value: "ANNUAL", label: "Annual" },
  { value: "SPECIAL", label: "Special" },
  { value: "BOARD", label: "Board" },
];

/**
 * The fractions co-op bylaws are written in.
 *
 * Offered as a list rather than a free-text percentage because two-thirds is
 * not 66.67%: of 1200 shares, two-thirds is exactly 800 and 66.67% demands 801,
 * so the meeting with precisely two-thirds present would be called inquorate
 * over a rounding artefact.
 */
const FRACTIONS: ReadonlyArray<{
  key: string;
  label: string;
  numerator: number;
  denominator: number;
  strict: boolean;
}> = [
  {
    key: "majority",
    label: "A majority (more than half)",
    numerator: 1,
    denominator: 2,
    strict: true,
  },
  { key: "half", label: "Half or more", numerator: 1, denominator: 2, strict: false },
  {
    key: "two-thirds",
    label: "Two-thirds",
    numerator: 2,
    denominator: 3,
    strict: false,
  },
  {
    key: "more-than-two-thirds",
    label: "More than two-thirds",
    numerator: 2,
    denominator: 3,
    strict: true,
  },
  {
    key: "three-quarters",
    label: "Three-quarters",
    numerator: 3,
    denominator: 4,
    strict: false,
  },
];

function fractionByKey(key: string) {
  return FRACTIONS.find((f) => f.key === key) ?? FRACTIONS[0]!;
}

// --- Calling a meeting -----------------------------------------------------

export function ScheduleMeeting({
  buildingSlug,
  defaultDate,
}: {
  buildingSlug: string;
  defaultDate: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [type, setType] = useState<MeetingType>("ANNUAL");
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState("19:30");
  const [location, setLocation] = useState("");
  const [agenda, setAgenda] = useState("");
  const [quorum, setQuorum] = useState("two-thirds");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});
    const fraction = fractionByKey(quorum);

    startTransition(async () => {
      const result = await scheduleMeetingAction({
        buildingSlug,
        title,
        type,
        date,
        time,
        location: location || null,
        agenda: agenda || null,
        quorumNumerator: fraction.numerator,
        quorumDenominator: fraction.denominator,
        quorumStrict: fraction.strict,
      });

      if (result.ok) {
        setOpen(false);
        setTitle("");
        setAgenda("");
        router.push(`/b/${buildingSlug}/meetings/${result.data.meetingId}`);
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  if (!open) {
    return (
      <Button intent="primary" size="sm" onClick={() => setOpen(true)}>
        Call a meeting
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

      <div className="grid gap-3 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <Field label="What the meeting is" error={fieldError["title"]}>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className={inputClass}
              placeholder="2027 annual shareholders meeting"
            />
          </Field>
        </div>

        <Field label="Kind">
          <select
            value={type}
            onChange={(event) => setType(event.target.value as MeetingType)}
            className={inputClass}
          >
            {MEETING_TYPES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Where">
          <input
            value={location}
            onChange={(event) => setLocation(event.target.value)}
            className={inputClass}
            placeholder="Parlor floor, 1F"
          />
        </Field>

        <Field label="Date" error={fieldError["scheduledFor"]}>
          <input
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Time" hint="The building's own clock.">
          <input
            type="time"
            value={time}
            onChange={(event) => setTime(event.target.value)}
            className={inputClass}
          />
        </Field>

        <div className="sm:col-span-2">
          <Field
            label="Quorum under the bylaws"
            hint="Measured in shares, not apartments."
            error={fieldError["quorumNumerator"]}
          >
            <select
              value={quorum}
              onChange={(event) => setQuorum(event.target.value)}
              className={inputClass}
            >
              {FRACTIONS.map((fraction) => (
                <option key={fraction.key} value={fraction.key}>
                  {fraction.label}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      <div className="mt-3">
        <Field label="Agenda" hint="What is being put to the room.">
          <textarea
            rows={3}
            value={agenda}
            onChange={(event) => setAgenda(event.target.value)}
            className={textareaClass}
            placeholder={
              "1. Minutes of the last meeting\n2. Treasurer's report\n3. Facade repointing"
            }
          />
        </Field>
      </div>

      <div className="mt-4 flex gap-2">
        <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Calling…" : "Call it"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// --- Attendance ------------------------------------------------------------

const MODES: ReadonlyArray<{ value: AttendanceMode | "ABSENT"; label: string }> = [
  { value: "ABSENT", label: "Absent" },
  { value: "IN_PERSON", label: "In the room" },
  { value: "REMOTE", label: "Remote" },
];

export interface RosterRow {
  readonly unitId: string;
  readonly label: string;
  readonly holderName: string | null;
  readonly shares: number;
  readonly mode: AttendanceMode | null;
  readonly proxyHolder: string | null;
  readonly proxyId: string | null;
}

/**
 * The roster, ticked as people arrive.
 *
 * Every change re-reads quorum from the server, so the meter above moves as the
 * room fills. A unit represented by proxy is shown as such and cannot be
 * switched from this control — that takes revoking the proxy, which is a
 * different act with a different record.
 */
export function AttendanceRoster({
  buildingSlug,
  meetingId,
  rows,
  locked,
}: {
  buildingSlug: string;
  meetingId: string;
  rows: readonly RosterRow[];
  locked: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function set(unitId: string, next: AttendanceMode | "ABSENT"): void {
    setError(null);
    setBusy(unitId);

    startTransition(async () => {
      const result =
        next === "ABSENT"
          ? await clearAttendanceAction({ buildingSlug, meetingId, unitId })
          : await recordAttendanceAction({
              buildingSlug,
              meetingId,
              unitId,
              mode: next,
            });

      if (!result.ok) setError(result.message);
      setBusy(null);
    });
  }

  return (
    <div>
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Attendance by apartment</caption>
          <thead>
            <tr className="border-limestone-deep border-b">
              <th scope="col" className="eyebrow pr-4 pb-2 font-normal">
                Apartment
              </th>
              <th scope="col" className="eyebrow pr-4 pb-2 text-right font-normal">
                Shares
              </th>
              <th scope="col" className="eyebrow pb-2 font-normal">
                Represented
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.unitId} className="ledger-row align-baseline">
                <td className="py-2.5 pr-4">
                  <span className="text-ironwork block font-mono text-xs">
                    {row.label}
                  </span>
                  {row.holderName ? (
                    <span className="text-ironwork-faint text-[0.6875rem]">
                      {row.holderName}
                    </span>
                  ) : null}
                </td>
                <td className="text-ironwork-soft py-2.5 pr-4 text-right font-mono text-xs">
                  {row.shares.toLocaleString("en-US")}
                </td>
                <td className="py-2.5">
                  {row.mode === "PROXY" ? (
                    <span className="text-ironwork-soft font-mono text-xs">
                      by proxy · {row.proxyHolder ?? "—"}
                    </span>
                  ) : locked ? (
                    <span className="text-ironwork-soft font-mono text-xs">
                      {MODES.find((m) => m.value === (row.mode ?? "ABSENT"))?.label}
                    </span>
                  ) : (
                    <select
                      aria-label={`How ${row.label} is represented`}
                      value={row.mode ?? "ABSENT"}
                      disabled={busy === row.unitId}
                      onChange={(event) =>
                        set(row.unitId, event.target.value as AttendanceMode | "ABSENT")
                      }
                      className={`${inputClass} max-w-44`}
                    >
                      {MODES.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// --- Proxies ---------------------------------------------------------------

export function GrantProxy({
  buildingSlug,
  meetingId,
  units,
  label = "Record a proxy",
}: {
  buildingSlug: string;
  meetingId: string;
  units: ReadonlyArray<{ id: string; label: string }>;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [holderName, setHolderName] = useState("");
  const [evidence, setEvidence] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});

    startTransition(async () => {
      const result = await grantProxyAction({
        buildingSlug,
        meetingId,
        unitId,
        holderName,
        evidence: evidence || null,
      });

      if (result.ok) {
        setOpen(false);
        setHolderName("");
        setEvidence("");
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  if (units.length === 0) return null;

  if (!open) {
    return (
      <div>
        {error ? (
          <p role="alert" className="text-stamp mb-2 text-sm">
            {error}
          </p>
        ) : null}
        <Button size="sm" onClick={() => setOpen(true)}>
          {label}
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

        <Field label="Held by" error={fieldError["holderName"]}>
          <input
            value={holderName}
            onChange={(event) => setHolderName(event.target.value)}
            className={inputClass}
            placeholder="Nora Whitfield"
          />
        </Field>

        <Field label="Evidence" hint="How the grant was captured.">
          <input
            value={evidence}
            onChange={(event) => setEvidence(event.target.value)}
            className={inputClass}
            placeholder="Signed proxy form, filed"
          />
        </Field>
      </div>

      <div className="mt-4 flex gap-2">
        <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Recording…" : "Record it"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function RevokeProxy({
  buildingSlug,
  proxyId,
}: {
  buildingSlug: string;
  proxyId: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <span>
      {error ? (
        <span role="alert" className="text-stamp mr-2 text-xs">
          {error}
        </span>
      ) : null}
      <Button
        intent="quiet"
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await revokeProxyAction({ buildingSlug, proxyId });
            if (!result.ok) setError(result.message);
          })
        }
      >
        {pending ? "Revoking…" : "Revoke"}
      </Button>
    </span>
  );
}

// --- Resolutions -----------------------------------------------------------

const CHOICES: ReadonlyArray<{ value: VoteChoice | "NONE"; label: string }> = [
  { value: "NONE", label: "—" },
  { value: "FOR", label: "For" },
  { value: "AGAINST", label: "Against" },
  { value: "ABSTAIN", label: "Abstain" },
];

const BASES: ReadonlyArray<{
  value: "VOTED" | "PRESENT" | "OUTSTANDING";
  label: string;
}> = [
  { value: "VOTED", label: "Shares voted (abstentions ignored)" },
  { value: "PRESENT", label: "Shares present (an abstention counts against)" },
  { value: "OUTSTANDING", label: "All shares in the building" },
];

export interface VoterRow {
  readonly unitId: string;
  readonly label: string;
  readonly shares: number;
  readonly byProxy: boolean;
}

/**
 * Recording a motion and how the room voted on it.
 *
 * The secretary marks apartments, not shares. Asking anyone to add up 260 and
 * 210 and 180 under time pressure is asking for the one arithmetic mistake this
 * whole module exists to prevent — so the running total is shown as they go,
 * and the tally that gets stored is computed on the server from the same
 * register.
 */
export function RecordResolution({
  buildingSlug,
  meetingId,
  voters,
}: {
  buildingSlug: string;
  meetingId: string;
  voters: readonly VoterRow[];
}) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [threshold, setThreshold] = useState("majority");
  const [basis, setBasis] = useState<"VOTED" | "PRESENT" | "OUTSTANDING">("VOTED");
  const [choices, setChoices] = useState<Record<string, VoteChoice | "NONE">>({});
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  const tally = { FOR: 0, AGAINST: 0, ABSTAIN: 0 };
  for (const voter of voters) {
    const choice = choices[voter.unitId] ?? "NONE";
    if (choice !== "NONE") tally[choice] += voter.shares;
  }

  function submit(): void {
    setError(null);
    setFieldError({});
    const fraction = fractionByKey(threshold);

    const votes = voters
      .map((voter) => ({
        unitId: voter.unitId,
        choice: choices[voter.unitId] ?? "NONE",
        byProxy: voter.byProxy,
      }))
      .filter(
        (vote): vote is { unitId: string; choice: VoteChoice; byProxy: boolean } =>
          vote.choice !== "NONE",
      );

    startTransition(async () => {
      const result = await recordResolutionAction({
        buildingSlug,
        meetingId,
        title,
        text,
        votes,
        thresholdNumerator: fraction.numerator,
        thresholdDenominator: fraction.denominator,
        thresholdStrict: fraction.strict,
        basis,
      });

      if (result.ok) {
        setOpen(false);
        setTitle("");
        setText("");
        setChoices({});
      } else {
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
          Record a resolution
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
        <Field label="What was moved" error={fieldError["title"]}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
            placeholder="Repoint the rear facade"
          />
        </Field>

        <Field
          label="Carries on"
          hint="What the bylaws require for this kind of motion."
        >
          <select
            value={threshold}
            onChange={(event) => setThreshold(event.target.value)}
            className={inputClass}
          >
            {FRACTIONS.map((fraction) => (
              <option key={fraction.key} value={fraction.key}>
                {fraction.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="mt-3">
        <Field label="The words put to the room" error={fieldError["text"]}>
          <textarea
            rows={3}
            value={text}
            onChange={(event) => setText(event.target.value)}
            className={textareaClass}
            placeholder="Resolved, that the corporation engage a mason to repoint the rear facade, at a cost not to exceed $48,000, funded from reserves."
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="Measured against">
          <select
            value={basis}
            onChange={(event) =>
              setBasis(event.target.value as "VOTED" | "PRESENT" | "OUTSTANDING")
            }
            className={inputClass}
          >
            {BASES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </Field>
      </div>

      <div className="border-limestone mt-4 border-t pt-4">
        <p className="eyebrow mb-2">How each apartment voted</p>
        {voters.length === 0 ? (
          <p className="text-ironwork-soft text-sm">
            Nobody is recorded as present yet, so there is no one to vote. Mark the
            attendance above first.
          </p>
        ) : (
          <>
            <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
              {voters.map((voter) => (
                <div key={voter.unitId} className="flex items-center gap-2">
                  <span className="text-ironwork w-24 shrink-0 font-mono text-xs">
                    {voter.label}
                    {voter.byProxy ? (
                      <span className="text-ironwork-faint"> ·p</span>
                    ) : null}
                  </span>
                  <span className="text-ironwork-faint w-14 shrink-0 text-right font-mono text-[0.6875rem]">
                    {voter.shares.toLocaleString("en-US")}
                  </span>
                  <select
                    aria-label={`How ${voter.label} voted`}
                    value={choices[voter.unitId] ?? "NONE"}
                    onChange={(event) =>
                      setChoices((current) => ({
                        ...current,
                        [voter.unitId]: event.target.value as VoteChoice | "NONE",
                      }))
                    }
                    className={inputClass}
                  >
                    {CHOICES.map((choice) => (
                      <option key={choice.value} value={choice.value}>
                        {choice.label}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <p className="text-ironwork-soft mt-3 font-mono text-xs">
              {tally.FOR.toLocaleString("en-US")} for ·{" "}
              {tally.AGAINST.toLocaleString("en-US")} against ·{" "}
              {tally.ABSTAIN.toLocaleString("en-US")} abstaining
            </p>
          </>
        )}
      </div>

      <div className="mt-4 flex gap-2">
        <Button intent="primary" size="sm" disabled={pending} onClick={submit}>
          {pending ? "Recording…" : "Record the vote"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// --- Minutes ---------------------------------------------------------------

/**
 * Drafting the minutes, and adopting them.
 *
 * Adoption is the one irreversible act in the module, so it asks twice and says
 * plainly what it closes. A board that finds an error afterwards corrects it at
 * the next meeting — which is how the record survives the board that kept it.
 */
export function MinutesEditor({
  buildingSlug,
  meetingId,
  initial,
}: {
  buildingSlug: string;
  meetingId: string;
  initial: string;
}) {
  const [minutes, setMinutes] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function save(): void {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await saveMinutesAction({ buildingSlug, meetingId, minutes });
      if (result.ok) setSaved(true);
      else setError(result.message);
    });
  }

  function adopt(): void {
    setError(null);
    startTransition(async () => {
      // Save first: adopting a draft the officer has edited but not saved would
      // freeze the version on the server, not the one on their screen.
      const stored = await saveMinutesAction({ buildingSlug, meetingId, minutes });
      if (!stored.ok) {
        setError(stored.message);
        setConfirming(false);
        return;
      }

      const result = await adoptMinutesAction({ buildingSlug, meetingId });
      if (!result.ok) setError(result.message);
      setConfirming(false);
    });
  }

  return (
    <div>
      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      <Field label="Draft minutes">
        <textarea
          rows={10}
          value={minutes}
          onChange={(event) => {
            setMinutes(event.target.value);
            setSaved(false);
          }}
          className={textareaClass}
          placeholder="The president called the meeting to order at 7.35pm. Quorum was confirmed at 890 shares of 1,200."
        />
      </Field>

      {confirming ? (
        <div className="border-stamp bg-stamp-soft mt-4 border-l-2 px-3 py-2">
          <p className="text-ironwork text-sm">
            Adopting closes this meeting&rsquo;s record for good: no more attendance, no
            more proxies, no more resolutions, and these minutes can never be edited
            again. A correction after this has to be made at the next meeting.
          </p>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save draft"}
        </Button>

        {confirming ? (
          <Button intent="primary" size="sm" disabled={pending} onClick={adopt}>
            Yes, adopt them
          </Button>
        ) : (
          <Button intent="primary" size="sm" onClick={() => setConfirming(true)}>
            Adopt the minutes
          </Button>
        )}

        {confirming ? (
          <Button intent="quiet" size="sm" onClick={() => setConfirming(false)}>
            Not yet
          </Button>
        ) : null}

        {saved ? (
          <span className="text-ironwork-faint font-mono text-xs">Saved</span>
        ) : null}
      </div>
    </div>
  );
}

// --- Held --------------------------------------------------------------------

export function MeetingHeldToggle({
  buildingSlug,
  meetingId,
  held,
}: {
  buildingSlug: string;
  meetingId: string;
  held: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap items-center gap-3">
      {error ? (
        <p role="alert" className="text-stamp basis-full text-sm">
          {error}
        </p>
      ) : null}
      <Button
        size="sm"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await updateMeetingAction({
              buildingSlug,
              meetingId,
              held: !held,
            });
            if (!result.ok) setError(result.message);
          })
        }
      >
        {pending ? "Saving…" : held ? "Mark as not yet held" : "Mark as held"}
      </Button>
    </div>
  );
}
