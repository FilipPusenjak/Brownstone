"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, inputClass } from "~/components/patterns/Button";
import { floorLabel } from "~/lib/building/floors";
import type { Borough } from "~/lib/nyc/address";
import type { Lookup } from "~/lib/nyc/lookup";
import {
  DEFAULT_SHARES,
  MAX_APARTMENTS,
  proposeApartments,
  type ApartmentInput,
} from "~/lib/primitives/founding";
import { formatBasisPoints, weightOf } from "~/lib/primitives/shares";
import { foundBuildingAction, lookupBuildingAction } from "./actions";

/**
 * Setting a building up, in two passes.
 *
 * The address first, on its own, because everything after it is easier once
 * the city has answered — and because a form that shows twenty fields to
 * somebody who has typed nothing reads as work. The second pass is checking,
 * which is a different and much shorter job than filling in.
 *
 * Nothing here blocks on the lookup succeeding. "Enter it myself" is always
 * available and does exactly the same thing minus the prefill, because the one
 * outcome this flow cannot have is a co-op that could not start keeping
 * records because a city API was down.
 */

const BOROUGHS: Array<{ value: Borough; label: string }> = [
  { value: "BROOKLYN", label: "Brooklyn" },
  { value: "MANHATTAN", label: "Manhattan" },
  { value: "QUEENS", label: "Queens" },
  { value: "BRONX", label: "the Bronx" },
  { value: "STATEN_ISLAND", label: "Staten Island" },
];

const GAS = [
  { value: "HEATING_AND_COOKING", label: "Heating and cooking" },
  { value: "COOKING_ONLY", label: "Cooking only" },
  { value: "NONE", label: "No gas service" },
  { value: "UNKNOWN", label: "Not sure" },
] as const;

const SPRINKLERS = [
  { value: "NONE", label: "None" },
  { value: "PARTIAL", label: "Part of the building" },
  { value: "FULL", label: "Throughout" },
  { value: "UNKNOWN", label: "Not sure" },
] as const;

type Gas = (typeof GAS)[number]["value"];
type Sprinklers = (typeof SPRINKLERS)[number]["value"];

export function NewBuildingForm() {
  const router = useRouter();

  // --- Pass one: where is it -------------------------------------------------
  const [name, setName] = useState("");
  const [legalName, setLegalName] = useState("");
  const [addressLine1, setAddressLine1] = useState("");
  const [borough, setBorough] = useState<Borough>("BROOKLYN");
  const [zip, setZip] = useState("");

  const [lookup, setLookup] = useState<Lookup | null>(null);
  const [looking, startLooking] = useTransition();
  const [opened, setOpened] = useState(false);

  // --- Pass two: what it is --------------------------------------------------
  const [floorNaming, setFloorNaming] = useState<"BROWNSTONE" | "NUMERIC">(
    "BROWNSTONE",
  );
  const [stories, setStories] = useState("4");
  const [yearBuilt, setYearBuilt] = useState("");
  const [grossSquareFeet, setGrossSquareFeet] = useState("");
  const [facadeHeightFt, setFacadeHeightFt] = useState("");
  const [hasElevator, setHasElevator] = useState(false);
  const [gasService, setGasService] = useState<Gas>("HEATING_AND_COOKING");
  const [oilTankPresent, setOilTankPresent] = useState(false);
  const [sprinklerStatus, setSprinklerStatus] = useState<Sprinklers>("NONE");
  const [isLandmarked, setIsLandmarked] = useState(false);
  const [hasParapet, setHasParapet] = useState(true);

  const [apartments, setApartments] = useState<ApartmentInput[]>([]);
  const [ownLabel, setOwnLabel] = useState("");
  const [title, setTitle] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [saving, startSaving] = useTransition();

  const total = apartments.reduce((sum, apartment) => sum + (apartment.shares || 0), 0);

  function rebuild(
    count: number,
    storeyCount: number,
    naming: "BROWNSTONE" | "NUMERIC",
  ) {
    setApartments(
      proposeApartments({
        apartmentCount: Math.min(count, MAX_APARTMENTS),
        stories: storeyCount,
        floorNaming: naming,
      }).map((apartment) => ({ ...apartment })),
    );
  }

  function look(): void {
    setError(null);
    startLooking(async () => {
      const result = await lookupBuildingAction({ addressLine1, borough });
      if (!result.ok) {
        setError(result.message);
        return;
      }

      const found = result.data;
      setLookup(found);
      setOpened(true);

      if (found.kind !== "found") {
        // Nothing to prefill, but the list still needs to exist to be edited.
        if (apartments.length === 0) rebuild(6, Number(stories) || 4, floorNaming);
        return;
      }

      const city = found.attributes;
      const storeyCount = city.stories ?? (Number(stories) || 4);
      if (city.stories !== null) setStories(String(city.stories));
      if (city.yearBuilt !== null) setYearBuilt(String(city.yearBuilt));
      if (city.grossSquareFeet !== null)
        setGrossSquareFeet(String(city.grossSquareFeet));
      if (city.facadeHeightFt !== null) setFacadeHeightFt(String(city.facadeHeightFt));
      if (city.isLandmarked !== null) setIsLandmarked(city.isLandmarked);
      if (city.zip !== null && !zip.trim()) setZip(city.zip);

      rebuild(city.unitCount ?? 6, storeyCount, floorNaming);
    });
  }

  function enterManually(): void {
    setLookup(null);
    setOpened(true);
    if (apartments.length === 0) rebuild(6, Number(stories) || 4, floorNaming);
  }

  function editApartment(index: number, patch: Partial<ApartmentInput>): void {
    setApartments((current) =>
      current.map((apartment, i) =>
        i === index ? { ...apartment, ...patch } : apartment,
      ),
    );
  }

  function addApartment(): void {
    setApartments((current) => [
      ...current,
      {
        label: "",
        floorIndex: current[current.length - 1]?.floorIndex ?? 1,
        line: null,
        shares: DEFAULT_SHARES,
      },
    ]);
  }

  function removeApartment(index: number): void {
    setApartments((current) => current.filter((_, i) => i !== index));
    const removed = apartments[index];
    if (removed && removed.label === ownLabel) setOwnLabel("");
  }

  function submit(): void {
    setError(null);
    setFieldError({});

    startSaving(async () => {
      const result = await foundBuildingAction({
        name,
        legalName: legalName || null,
        addressLine1,
        // Nothing in a New York co-op's address goes here, and the column
        // stays for the building settings page to fill in if one ever does.
        addressLine2: null,
        borough,
        zip,
        // The clock the building keeps. Every co-op this product is for is in
        // one time zone, and asking would be a question with one answer.
        timezone: "America/New_York",
        floorNaming,
        stories: Number(stories) || 0,
        yearBuilt: yearBuilt ? Number(yearBuilt) : null,
        grossSquareFeet: grossSquareFeet ? Number(grossSquareFeet) : null,
        facadeHeightFt: facadeHeightFt ? Number(facadeHeightFt) : null,
        hasElevator,
        gasService,
        oilTankPresent,
        sprinklerStatus,
        isLandmarked,
        hasParapet,
        apartments,
        ownLabel: ownLabel || null,
        title: title || null,
      });

      if (result.ok) {
        router.push(`/b/${result.data.slug}/compliance/rules`);
        return;
      }
      setError(result.message);
      setFieldError(result.fields ?? {});
    });
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p role="alert" className="text-stamp text-sm">
          {error}
        </p>
      ) : null}

      {/* ---- Where is it ---------------------------------------------------- */}
      <section className="sheet px-6 py-6">
        <h2 className="text-ironwork text-sm font-semibold">Where is it?</h2>

        <div className="mt-4 space-y-4">
          <Field
            label="What do you call it?"
            hint="However the building is known — “The Adelaide”, “114 Bergen”."
            error={fieldError["name"]}
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={inputClass}
              placeholder="The Adelaide"
            />
          </Field>

          <Field
            label="Street address"
            hint="Just the number and the street. Apartment numbers come later."
            error={fieldError["addressLine1"]}
          >
            <input
              value={addressLine1}
              onChange={(event) => setAddressLine1(event.target.value)}
              className={inputClass}
              placeholder="150 Bergen Street"
            />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Borough">
              <select
                value={borough}
                onChange={(event) => setBorough(event.target.value as Borough)}
                className={inputClass}
              >
                {BOROUGHS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="ZIP" error={fieldError["zip"]}>
              <input
                value={zip}
                onChange={(event) => setZip(event.target.value)}
                className={inputClass}
                inputMode="numeric"
                placeholder="11217"
              />
            </Field>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button
            intent="primary"
            onClick={look}
            disabled={looking || !addressLine1.trim()}
          >
            {looking ? "Asking the city…" : "Look it up"}
          </Button>
          <Button intent="quiet" onClick={enterManually} disabled={looking}>
            Enter it myself
          </Button>
        </div>

        {lookup ? <LookupNote lookup={lookup} /> : null}
      </section>

      {/* ---- What it is ----------------------------------------------------- */}
      {opened ? (
        <>
          <section className="sheet px-6 py-6">
            <h2 className="text-ironwork text-sm font-semibold">
              What kind of building?
            </h2>
            <p className="text-ironwork-faint mt-1 text-xs">
              These decide which laws the compliance calendar proposes, so they are
              worth a second look even where the city filled them in.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="How are the floors named?"
                hint="A brownstone has a garden and a parlor floor. A walk-up has numbers."
              >
                <select
                  value={floorNaming}
                  onChange={(event) => {
                    const next = event.target.value as "BROWNSTONE" | "NUMERIC";
                    setFloorNaming(next);
                    rebuild(apartments.length || 6, Number(stories) || 4, next);
                  }}
                  className={inputClass}
                >
                  <option value="BROWNSTONE">Garden, parlor, second…</option>
                  <option value="NUMERIC">1, 2, 3…</option>
                </select>
              </Field>

              <Field
                label="Storeys"
                hint="Not counting a garden level."
                error={fieldError["stories"]}
              >
                <input
                  value={stories}
                  onChange={(event) => setStories(event.target.value)}
                  className={inputClass}
                  inputMode="numeric"
                />
              </Field>

              <Field label="Year built" error={fieldError["yearBuilt"]}>
                <input
                  value={yearBuilt}
                  onChange={(event) => setYearBuilt(event.target.value)}
                  className={inputClass}
                  inputMode="numeric"
                  placeholder="1899"
                />
              </Field>

              <Field label="Residential square feet">
                <input
                  value={grossSquareFeet}
                  onChange={(event) => setGrossSquareFeet(event.target.value)}
                  className={inputClass}
                  inputMode="numeric"
                />
              </Field>

              <Field
                label="Height to the roof, in feet"
                hint="Decides whether the facade inspection cycle applies."
              >
                <input
                  value={facadeHeightFt}
                  onChange={(event) => setFacadeHeightFt(event.target.value)}
                  className={inputClass}
                  inputMode="numeric"
                />
              </Field>

              <Field label="Gas service">
                <select
                  value={gasService}
                  onChange={(event) => setGasService(event.target.value as Gas)}
                  className={inputClass}
                >
                  {GAS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Sprinklers">
                <select
                  value={sprinklerStatus}
                  onChange={(event) =>
                    setSprinklerStatus(event.target.value as Sprinklers)
                  }
                  className={inputClass}
                >
                  {SPRINKLERS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Legal name" hint="As it appears on the offering plan.">
                <input
                  value={legalName}
                  onChange={(event) => setLegalName(event.target.value)}
                  className={inputClass}
                  placeholder="Adelaide Place Owners Corp."
                />
              </Field>
            </div>

            <fieldset className="rounded-sheet border-limestone bg-paper mt-4 border px-4 py-3">
              <legend className="eyebrow px-1">Also true of the building</legend>
              <div className="space-y-2.5">
                <Check
                  checked={hasElevator}
                  onChange={setHasElevator}
                  label="There's an elevator"
                  hint="Brings the periodic elevator inspections onto the calendar."
                />
                <Check
                  checked={isLandmarked}
                  onChange={setIsLandmarked}
                  label="Landmarked, or in a historic district"
                  hint="Work on the facade needs the Landmarks Commission first."
                />
                <Check
                  checked={hasParapet}
                  onChange={setHasParapet}
                  label="There's a parapet at the roofline"
                  hint="Parapets have to be inspected annually under Local Law 126."
                />
                <Check
                  checked={oilTankPresent}
                  onChange={setOilTankPresent}
                  label="There's an oil tank"
                  hint="Including one that's out of use but still in the ground."
                />
              </div>
            </fieldset>
          </section>

          {/* ---- The apartments --------------------------------------------- */}
          <section className="sheet px-6 py-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-ironwork text-sm font-semibold">The apartments</h2>
              <p className="text-ironwork-faint font-mono text-xs">
                {apartments.length} apartments · {total} shares
              </p>
            </div>
            <p className="text-ironwork-soft mt-1 text-sm">
              Shares are what everything else divides by — quorum at a meeting, each
              apartment&rsquo;s part of a new roof, its share of the maintenance. Only
              the proportions matter, never the total. If the offering plan is not to
              hand, leave them even and correct them later.
            </p>
            {fieldError["apartments"] ? (
              <p className="text-stamp mt-2 text-sm">{fieldError["apartments"]}</p>
            ) : null}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-lg text-sm">
                <thead>
                  <tr className="text-ironwork-faint border-limestone border-b text-left">
                    <th className="eyebrow py-2 font-normal">Apartment</th>
                    <th className="eyebrow py-2 font-normal">Floor</th>
                    <th className="eyebrow py-2 font-normal">Shares</th>
                    <th className="eyebrow py-2 text-right font-normal">
                      Of the whole
                    </th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody className="divide-limestone divide-y">
                  {apartments.map((apartment, index) => (
                    <tr key={index}>
                      <td className="py-2 pr-3">
                        <input
                          aria-label={`Apartment ${index + 1} name`}
                          value={apartment.label}
                          onChange={(event) =>
                            editApartment(index, { label: event.target.value })
                          }
                          className={inputClass}
                        />
                      </td>
                      <td className="py-2 pr-3">
                        <select
                          aria-label={`Apartment ${index + 1} floor`}
                          value={apartment.floorIndex}
                          onChange={(event) =>
                            editApartment(index, {
                              floorIndex: Number(event.target.value),
                            })
                          }
                          className={inputClass}
                        >
                          {floorChoices(Number(stories) || 4, floorNaming).map(
                            (choice) => (
                              <option key={choice.index} value={choice.index}>
                                {choice.label}
                              </option>
                            ),
                          )}
                        </select>
                      </td>
                      <td className="py-2 pr-3">
                        <input
                          aria-label={`Apartment ${index + 1} shares`}
                          value={apartment.shares}
                          onChange={(event) =>
                            editApartment(index, {
                              shares:
                                Number(event.target.value.replace(/\D/g, "")) || 0,
                            })
                          }
                          className={inputClass}
                          inputMode="numeric"
                        />
                      </td>
                      <td className="text-ironwork-soft py-2 text-right font-mono text-xs">
                        {total > 0
                          ? formatBasisPoints(weightOf(apartment.shares || 0, total))
                          : "—"}
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <Button
                          intent="quiet"
                          size="sm"
                          onClick={() => removeApartment(index)}
                          aria-label={`Remove apartment ${index + 1}`}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={addApartment}
                disabled={apartments.length >= MAX_APARTMENTS}
              >
                Add an apartment
              </Button>
              <Button
                intent="quiet"
                size="sm"
                onClick={() =>
                  rebuild(apartments.length || 6, Number(stories) || 4, floorNaming)
                }
              >
                Start the list over
              </Button>
            </div>
          </section>

          {/* ---- You --------------------------------------------------------- */}
          <section className="sheet px-6 py-6">
            <h2 className="text-ironwork text-sm font-semibold">And you</h2>
            <p className="text-ironwork-soft mt-1 text-sm">
              You&rsquo;ll be the building&rsquo;s president to begin with, because
              somebody has to be able to invite everyone else. That can be handed on
              from the members page.
            </p>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Field
                label="Which apartment is yours?"
                hint="Leave blank if you manage the building without living in it."
                error={fieldError["ownLabel"]}
              >
                <select
                  value={ownLabel}
                  onChange={(event) => setOwnLabel(event.target.value)}
                  className={inputClass}
                >
                  <option value="">None — I don&rsquo;t hold an apartment</option>
                  {apartments
                    .filter((apartment) => apartment.label.trim())
                    .map((apartment, index) => (
                      <option key={index} value={apartment.label}>
                        {apartment.label}
                      </option>
                    ))}
                </select>
              </Field>

              <Field label="How should you be listed?">
                <input
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  className={inputClass}
                  placeholder="Board President"
                />
              </Field>
            </div>

            <div className="mt-6">
              <Button intent="primary" onClick={submit} disabled={saving}>
                {saving ? "Setting it up…" : "Set the building up"}
              </Button>
              <p className="text-ironwork-faint mt-3 text-xs">
                Next you&rsquo;ll see which of New York&rsquo;s requirements look like
                they apply here. Nothing reaches the calendar until you confirm it.
              </p>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}

/**
 * What the city said, in one line, phrased so that "we couldn't check" and
 * "the city has no record of this" are visibly different things. A founder
 * told the second when the truth is the first goes and digs out their deed.
 */
function LookupNote({ lookup }: { lookup: Lookup }) {
  if (lookup.kind === "found") {
    return (
      <p className="text-ironwork-soft border-verdigris mt-4 border-l-2 pl-3 text-sm">
        The city has <span className="font-mono">{lookup.matchedAddress}</span>
        {lookup.attributes.bbl ? (
          <>
            {" "}
            at BBL <span className="font-mono">{lookup.attributes.bbl}</span>
          </>
        ) : null}
        . Its figures are filled in below — check them.
      </p>
    );
  }

  if (lookup.kind === "not-found") {
    return (
      <p className="text-ironwork-soft border-limestone-deep mt-4 border-l-2 pl-3 text-sm">
        Nothing in the city&rsquo;s lot records matches that address, so the rest is
        yours to fill in. That is common enough for a corner building or a recent
        subdivision, and it changes nothing about how the building works here.
      </p>
    );
  }

  return (
    <p className="text-ironwork-soft border-limestone-deep mt-4 border-l-2 pl-3 text-sm">
      {lookup.reason} Fill the rest in yourself, or try the lookup again in a minute —
      neither changes what you end up with.
    </p>
  );
}

function floorChoices(
  stories: number,
  naming: "BROWNSTONE" | "NUMERIC",
): Array<{ index: number; label: string }> {
  const top = Math.max(1, Math.min(stories, 30));
  const from = naming === "BROWNSTONE" ? 0 : 1;
  const out: Array<{ index: number; label: string }> = [];
  for (let i = from; i <= top; i += 1)
    out.push({ index: i, label: floorLabel(i, naming) });
  return out;
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
    <label className="text-ironwork flex items-start gap-2.5 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-[#0b6e62]"
      />
      <span>
        {label}
        <span className="text-ironwork-faint mt-0.5 block text-xs">{hint}</span>
      </span>
    </label>
  );
}
