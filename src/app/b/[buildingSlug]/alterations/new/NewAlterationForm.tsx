"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, inputClass, textareaClass } from "~/components/patterns/Button";
import { submitAlterationAction } from "../actions";

/**
 * Filing an alteration request.
 *
 * The three checkboxes are the questions a co-op board always ends up asking,
 * so they are asked up front rather than discovered in the plans two weeks
 * later. Wet over dry — a bathroom or kitchen moved above a neighbour's dry
 * room — is the classic refusal, and a shareholder who has never heard the
 * phrase needs to be told what it means where they are being asked.
 */
export function NewAlterationForm({
  buildingSlug,
  units,
}: {
  buildingSlug: string;
  units: Array<{ id: string; label: string }>;
}) {
  const router = useRouter();
  const [unitId, setUnitId] = useState(units[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [scope, setScope] = useState("");
  const [contractorName, setContractorName] = useState("");
  const [contractorLicense, setContractorLicense] = useState("");
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [wetOverDry, setWetOverDry] = useState(false);
  const [affectsStructure, setAffectsStructure] = useState(false);
  const [affectsRiser, setAffectsRiser] = useState(false);
  const [requiresDobPermit, setRequiresDobPermit] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});

    startTransition(async () => {
      const result = await submitAlterationAction({
        buildingSlug,
        unitId,
        title,
        scope,
        contractorName: contractorName || null,
        contractorLicense: contractorLicense || null,
        plannedStart: plannedStart || null,
        plannedEnd: plannedEnd || null,
        wetOverDry,
        affectsStructure,
        affectsRiser,
        requiresDobPermit,
      });

      if (result.ok) {
        router.push(`/b/${buildingSlug}/alterations/${result.data.alterationId}`);
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  return (
    <div className="max-w-2xl">
      {error ? (
        <p role="alert" className="mb-4 text-sm text-stamp">
          {error}
        </p>
      ) : null}

      <div className="space-y-4">
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

        <Field label="What is the work?" error={fieldError["title"]}>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            className={inputClass}
            placeholder="Kitchen renovation"
          />
        </Field>

        <Field
          label="Describe it"
          hint="Enough for the board to decide. What changes, and does it touch plumbing, walls or the riser?"
          error={fieldError["scope"]}
        >
          <textarea
            rows={4}
            value={scope}
            onChange={(event) => setScope(event.target.value)}
            className={textareaClass}
            placeholder="Replace cabinets and counters, move the sink 60cm along the same wall, new dishwasher on the existing supply."
          />
        </Field>

        <fieldset className="rounded-sheet border border-limestone bg-paper px-4 py-3">
          <legend className="eyebrow px-1">The questions the board will ask</legend>
          <div className="space-y-2.5">
            <Check
              checked={wetOverDry}
              onChange={setWetOverDry}
              label="Wet over dry"
              hint="A kitchen or bathroom moving over a neighbour's bedroom or living room."
            />
            <Check
              checked={affectsStructure}
              onChange={setAffectsStructure}
              label="Touches structure"
              hint="Removing or opening a wall, changing a beam."
            />
            <Check
              checked={affectsRiser}
              onChange={setAffectsRiser}
              label="Touches the riser"
              hint="Anything tying into the building's stacks or supply lines."
            />
            <Check
              checked={requiresDobPermit}
              onChange={setRequiresDobPermit}
              label="Needs a DOB permit"
              hint="If you're not sure, your contractor will know."
            />
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Contractor">
            <input
              value={contractorName}
              onChange={(event) => setContractorName(event.target.value)}
              className={inputClass}
              placeholder="Bergen Street Builders"
            />
          </Field>
          <Field label="Licence number">
            <input
              value={contractorLicense}
              onChange={(event) => setContractorLicense(event.target.value)}
              className={inputClass}
              placeholder="HIC-2041188"
            />
          </Field>
          <Field label="Planned start" error={fieldError["plannedStart"]}>
            <input
              type="date"
              value={plannedStart}
              onChange={(event) => setPlannedStart(event.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Planned finish" error={fieldError["plannedEnd"]}>
            <input
              type="date"
              value={plannedEnd}
              onChange={(event) => setPlannedEnd(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      </div>

      <div className="mt-6 flex gap-2">
        <Button intent="primary" disabled={pending} onClick={submit}>
          {pending ? "Filing…" : "Submit to the board"}
        </Button>
      </div>

      <p className="mt-3 text-xs text-ironwork-faint">
        You can add plans and your contractor&rsquo;s insurance certificate on the
        next screen.
      </p>
    </div>
  );
}

function Check({
  checked,
  onChange,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex items-start gap-2.5 text-sm text-ironwork">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[#0b6e62]"
      />
      <span>
        {label}
        <span className="mt-0.5 block text-xs text-ironwork-faint">{hint}</span>
      </span>
    </label>
  );
}
