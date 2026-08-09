"use client";

import { useState, useTransition } from "react";
import { Button, Field, inputClass } from "~/components/patterns/Button";
import { parseMoney } from "~/lib/money";
import { recordCertificateAction } from "./actions";

/**
 * Recording a certificate of insurance.
 *
 * The additional-insured checkbox is not a formality. A certificate that does
 * not name the corporation is valid on its face and worthless to the building,
 * and it is the single most common defect in a co-op COI — so it is asked
 * directly, recorded as a verified fact, and shown on the certificate list
 * rather than buried.
 */
export function CertificateForm({
  buildingSlug,
  alterationId,
  unitId,
  defaultHolderName,
  onRecorded,
}: {
  buildingSlug: string;
  alterationId?: string | null;
  unitId?: string | null;
  defaultHolderName?: string | null;
  onRecorded?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [holderName, setHolderName] = useState(defaultHolderName ?? "");
  const [holderKind, setHolderKind] = useState<
    "CONTRACTOR" | "MOVER" | "SHAREHOLDER" | "VENDOR"
  >("CONTRACTOR");
  const [carrier, setCarrier] = useState("");
  const [policyNumber, setPolicyNumber] = useState("");
  const [coverage, setCoverage] = useState("");
  const [effectiveOn, setEffectiveOn] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function save(): void {
    setError(null);
    setFieldError({});

    const coverageCents = coverage ? parseMoney(coverage) : null;
    if (coverage && coverageCents === null) {
      setFieldError({ coverage: "Enter an amount, like 1,000,000." });
      return;
    }

    startTransition(async () => {
      const result = await recordCertificateAction({
        buildingSlug,
        alterationId: alterationId ?? null,
        holderKind,
        holderName,
        carrier,
        policyNumber,
        coverageCents,
        effectiveOn,
        expiresOn,
        unitId: unitId ?? null,
        alterationRequestId: alterationId ?? null,
        additionalInsuredVerified: verified,
      });

      if (result.ok) {
        setOpen(false);
        setHolderName(defaultHolderName ?? "");
        setCarrier("");
        setPolicyNumber("");
        setCoverage("");
        setEffectiveOn("");
        setExpiresOn("");
        setVerified(false);
        onRecorded?.();
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  if (!open) {
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        Record a certificate
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

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Insured party" error={fieldError["holderName"]}>
          <input
            value={holderName}
            onChange={(event) => setHolderName(event.target.value)}
            className={inputClass}
            placeholder="Bergen Street Builders"
          />
        </Field>

        <Field label="Who they are">
          <select
            value={holderKind}
            onChange={(event) => setHolderKind(event.target.value as typeof holderKind)}
            className={inputClass}
          >
            <option value="CONTRACTOR">Contractor</option>
            <option value="MOVER">Mover</option>
            <option value="SHAREHOLDER">Shareholder</option>
            <option value="VENDOR">Vendor</option>
          </select>
        </Field>

        <Field label="Carrier">
          <input
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
            className={inputClass}
            placeholder="Hartford Casualty"
          />
        </Field>

        <Field label="Policy number">
          <input
            value={policyNumber}
            onChange={(event) => setPolicyNumber(event.target.value)}
            className={inputClass}
            placeholder="GL-4471902"
          />
        </Field>

        <Field label="Coverage" hint="Dollars." error={fieldError["coverage"]}>
          <input
            value={coverage}
            onChange={(event) => setCoverage(event.target.value)}
            className={inputClass}
            placeholder="1,000,000"
          />
        </Field>

        <div />

        <Field label="Effective from" error={fieldError["effectiveOn"]}>
          <input
            type="date"
            value={effectiveOn}
            onChange={(event) => setEffectiveOn(event.target.value)}
            className={inputClass}
          />
        </Field>

        <Field label="Expires" error={fieldError["expiresOn"]}>
          <input
            type="date"
            value={expiresOn}
            onChange={(event) => setExpiresOn(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <label className="text-ironwork-soft mt-4 flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={verified}
          onChange={(event) => setVerified(event.target.checked)}
          className="mt-0.5 size-4 accent-[#0b6e62]"
        />
        <span>
          I&rsquo;ve checked the corporation is named as an additional insured.
          <span className="text-ironwork-faint mt-0.5 block text-xs">
            A certificate without this is valid but does nothing for the building.
          </span>
        </span>
      </label>

      <div className="mt-4 flex gap-2">
        <Button intent="primary" size="sm" disabled={pending} onClick={save}>
          {pending ? "Recording…" : "Record the certificate"}
        </Button>
        <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>

      <p className="text-ironwork-faint mt-3 text-xs">
        The expiry goes on the compliance calendar, with reminders 45, 14 and 3 days
        before.
      </p>
    </div>
  );
}
