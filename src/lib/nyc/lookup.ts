import { env } from "~/lib/env";
import {
  boroughCode,
  communityDistrict,
  normaliseBbl,
  plutoAddress,
  type Borough,
} from "./address";

/**
 * What the city already knows about a building.
 *
 * A board president setting Co-operator up does not necessarily know their
 * building's gross square footage, the year it went up, or its BBL — and
 * getting those wrong is not cosmetic. Every compliance rule's applicability
 * predicate reads from that attribute set and nothing else, so a unit count
 * typed as 5 instead of 6 silently changes which laws the calendar thinks
 * apply. The city has all of it, published, for nothing.
 *
 * Two datasets, in sequence:
 *
 *   PLUTO (64uk-42ks) is keyed by address and holds the lot: unit count,
 *   floors, year built, building area, community district, landmark status,
 *   and the BBL.
 *
 *   Building footprints (5zhs-2jue) is keyed by that BBL and holds the
 *   structure: the BIN, and the roof height in feet — which is the input to
 *   the facade inspection rule and is otherwise something a board would have to
 *   guess at.
 *
 * The single most important property of this module is that it cannot fail in
 * a way that matters. Every path returns; nothing throws; a timeout, an
 * outage, a schema change or a rate limit all come back as "we couldn't check"
 * and the form falls through to manual entry. A city API having a bad morning
 * must never be the reason a co-op cannot start keeping records.
 */

const PLUTO = "https://data.cityofnewyork.us/resource/64uk-42ks.json";
const FOOTPRINTS = "https://data.cityofnewyork.us/resource/5zhs-2jue.json";

/**
 * How long to wait, and why there are two answers.
 *
 * `INTERACTIVE` is the budget when somebody pressed "Look it up" and is
 * watching a button that says what it is doing. Six seconds is long enough for
 * a cold Socrata query and short enough not to read as a hang.
 *
 * `VERIFYING` is the budget when the lookup is checking provenance behind a
 * submit — nobody asked for it, and every millisecond is a stall on the most
 * important button in the flow. Three seconds buys the common case; past that,
 * the answer is that we could not check, and `attributeSource` says MANUAL.
 * That is the honest outcome rather than a cost: NYC_OPEN_DATA is a claim that
 * the city's figures were compared against these ones, and a lookup that timed
 * out compared nothing.
 */
const INTERACTIVE_TIMEOUT_MS = 6_000;
const VERIFYING_TIMEOUT_MS = 3_000;

/** The attributes a lookup can fill in. Everything else stays the form's. */
export interface LookedUpAttributes {
  readonly unitCount: number | null;
  readonly stories: number | null;
  readonly yearBuilt: number | null;
  readonly grossSquareFeet: number | null;
  readonly facadeHeightFt: number | null;
  readonly isLandmarked: boolean | null;
  readonly zip: string | null;
  readonly communityDistrict: string | null;
  readonly bbl: string | null;
  readonly bin: string | null;
}

export type Lookup =
  | {
      readonly kind: "found";
      /** PLUTO's own spelling of the address, to show back as confirmation. */
      readonly matchedAddress: string;
      readonly attributes: LookedUpAttributes;
      /** Kept verbatim for BuildingDataLookup — the record of what was read. */
      readonly payload: Record<string, unknown>;
    }
  | { readonly kind: "not-found"; readonly triedAddress: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export interface LookupQuery {
  readonly addressLine1: string;
  readonly borough: Borough;
  /**
   * "verifying" when nothing is waiting on the answer but a submit. Shortens
   * the budget; see the timeouts above.
   */
  readonly purpose?: "interactive" | "verifying";
}

export async function lookupBuilding(query: LookupQuery): Promise<Lookup> {
  const address = plutoAddress(query.addressLine1);
  if (!address) return { kind: "not-found", triedAddress: "" };

  const budget =
    query.purpose === "verifying" ? VERIFYING_TIMEOUT_MS : INTERACTIVE_TIMEOUT_MS;

  const lot = await fetchLot(address, query.borough, budget);
  if (lot.kind !== "found") return lot;

  const bbl = normaliseBbl(str(lot.row["bbl"]));
  // A footprint miss is not a failure: the lot's attributes are the ones that
  // drive applicability, and BIN and roof height are extras.
  const footprint = bbl ? await fetchFootprint(bbl, budget) : null;

  return {
    kind: "found",
    matchedAddress: str(lot.row["address"]) ?? address,
    attributes: {
      unitCount: int(lot.row["unitsres"]),
      stories: int(lot.row["numfloors"]),
      yearBuilt: plausibleYear(int(lot.row["yearbuilt"])),
      // Residential area where the lot has one, total floor area otherwise: a
      // brownstone with a storefront should not report the shop as apartments.
      grossSquareFeet: int(lot.row["resarea"]) || int(lot.row["bldgarea"]),
      facadeHeightFt: footprint ? int(footprint["height_roof"]) : null,
      isLandmarked: landmarked(lot.row),
      zip: str(lot.row["zipcode"]),
      communityDistrict: communityDistrict(str(lot.row["cd"])),
      bbl,
      bin: footprint ? str(footprint["bin"]) : null,
    },
    payload: { pluto: lot.row, ...(footprint ? { footprint } : {}) },
  };
}

type LotResult =
  | { kind: "found"; row: Record<string, unknown> }
  | { kind: "not-found"; triedAddress: string }
  | { kind: "unavailable"; reason: string };

async function fetchLot(
  address: string,
  borough: Borough,
  budget: number,
): Promise<LotResult> {
  const url = new URL(PLUTO);
  // Parameterised through Socrata's own quoting rules rather than concatenated:
  // an apostrophe in a street name would otherwise end the SoQL string.
  url.searchParams.set(
    "$where",
    `address=${soqlString(address)} AND borough=${soqlString(boroughCode(borough))}`,
  );
  url.searchParams.set("$limit", "2");

  const rows = await get(url, budget);
  if (!Array.isArray(rows)) return rows;

  // Exactly one lot, or nothing. Two lots sharing an address means the query
  // matched a corner property or a split parcel, and picking one of them for
  // the founder would be a guess wearing the city's authority.
  const first = rows[0];
  if (rows.length !== 1 || !isRecord(first)) {
    return { kind: "not-found", triedAddress: address };
  }
  return { kind: "found", row: first };
}

async function fetchFootprint(
  bbl: string,
  budget: number,
): Promise<Record<string, unknown> | null> {
  const url = new URL(FOOTPRINTS);
  url.searchParams.set("$where", `base_bbl=${soqlString(bbl)}`);
  url.searchParams.set("$select", "bin,base_bbl,height_roof,construction_year");
  url.searchParams.set("$limit", "2");

  const rows = await get(url, budget);
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const first = rows[0];
  return isRecord(first) ? first : null;
}

/**
 * One HTTP call, with every failure folded into a value.
 *
 * `unavailable` and `not-found` are kept apart on purpose. They lead to the
 * same screen — type it in yourself — but only one of them is worth saying
 * out loud, and a founder told "the city's records don't list this address"
 * when the truth is "the city's API timed out" will go and check their deed.
 */
async function get(
  url: URL,
  budget: number,
): Promise<unknown[] | { kind: "unavailable"; reason: string }> {
  const token = env().NYC_OPEN_DATA_APP_TOKEN;

  try {
    const response = await fetch(url, {
      headers: {
        accept: "application/json",
        // Raises the rate limit from the shared anonymous pool. Optional, and
        // the endpoints answer without it.
        ...(token ? { "X-App-Token": token } : {}),
      },
      signal: AbortSignal.timeout(budget),
      cache: "no-store",
    });

    if (response.status === 429) {
      return {
        kind: "unavailable",
        reason: "The city's data service is rate-limiting.",
      };
    }
    if (!response.ok) {
      return {
        kind: "unavailable",
        reason: `The city's data service answered ${response.status}.`,
      };
    }

    const body: unknown = await response.json();
    return Array.isArray(body) ? body : [];
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    return {
      kind: "unavailable",
      reason: timedOut
        ? "The city's data service didn't answer in time."
        : "The city's data service couldn't be reached.",
    };
  }
}

/** SoQL string literal: single quotes, doubled to escape. */
function soqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Socrata returns numbers as strings, and floors as `3.0000000`.
 *
 * Rounded rather than truncated: a mezzanine reported as 4.5 storeys is a
 * five-storey building for every rule that counts them.
 */
function int(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : str(value);
  if (text === null) return null;
  const parsed = Number(text);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed);
}

/**
 * PLUTO writes an unknown construction date as 0, and occasionally as a year
 * no building in New York was built in.
 */
function plausibleYear(value: number | null): number | null {
  if (value === null) return null;
  return value >= 1626 && value <= new Date().getUTCFullYear() + 1 ? value : null;
}

/**
 * Landmarked for the purpose that matters: needing the Landmarks Preservation
 * Commission's permission before touching the facade.
 *
 * An individual designation and a historic district have the same practical
 * effect on a brownstone, and a board that only checked the first would be
 * wrong about most of Brooklyn Heights, Park Slope and Fort Greene.
 */
function landmarked(row: Record<string, unknown>): boolean | null {
  const individual = str(row["landmark"]);
  const district = str(row["histdist"]);
  if (individual || district) return true;
  // Socrata omits null columns, so an absent pair means "not designated"
  // rather than "unknown" — the row itself came back, which is the evidence.
  return false;
}
