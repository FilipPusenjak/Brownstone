/**
 * Turning an address somebody typed into the one the city has on file.
 *
 * PLUTO stores addresses in a single normalised form, and it is not the form
 * anybody writes: `150 BERGEN STREET`, `84-74 257 STREET`, `EAST 10 STREET`.
 * A lookup that passes the address through unchanged misses almost every time,
 * and a founder who is told "we couldn't find your building" when the building
 * is plainly there stops trusting the prefill and types everything by hand —
 * which is the outcome this whole path exists to avoid.
 *
 * So the normalisation is deliberate, narrow, and tested against the real
 * dataset's conventions rather than against a general idea of what addresses
 * look like. Every rule below was checked by querying PLUTO, and the comments
 * record what it actually contains, not what it ought to.
 */

/**
 * Street-type abbreviations, expanded only in the final position.
 *
 * The final-position rule is the whole trick, and it exists because of one
 * street: PLUTO holds 288 lots on `ST MARKS PLACE` and four on `SAINT MARKS
 * PLACE`. Expanding `ST` wherever it appears turns St Marks Place into Street
 * Marks Place and finds nothing. A suffix is a suffix only at the end.
 */
const SUFFIXES: Record<string, string> = {
  ST: "STREET",
  STR: "STREET",
  AVE: "AVENUE",
  AV: "AVENUE",
  PL: "PLACE",
  RD: "ROAD",
  DR: "DRIVE",
  BLVD: "BOULEVARD",
  LN: "LANE",
  CT: "COURT",
  TER: "TERRACE",
  TERR: "TERRACE",
  PKWY: "PARKWAY",
  PKY: "PARKWAY",
  SQ: "SQUARE",
  PLZ: "PLAZA",
  CIR: "CIRCLE",
  EXPY: "EXPRESSWAY",
  HWY: "HIGHWAY",
  WY: "WAY",
};

/**
 * Compass directions, expanded anywhere.
 *
 * Unlike suffixes these are unambiguous, and PLUTO always spells them out:
 * `EAST 10 STREET` has 175 lots in Manhattan and `E 10 STREET` has none.
 */
const DIRECTIONS: Record<string, string> = {
  E: "EAST",
  W: "WEST",
  N: "NORTH",
  S: "SOUTH",
  NE: "NORTHEAST",
  NW: "NORTHWEST",
  SE: "SOUTHEAST",
  SW: "SOUTHWEST",
};

/**
 * Normalises an address line into PLUTO's form.
 *
 * Ordinal suffixes come off numbered streets — the dataset holds 517 lots on
 * `5 AVENUE` and three on `5TH AVENUE`, so the ordinal is the anomaly. House
 * numbers keep their hyphens, because in Queens `84-74` is the number.
 */
export function plutoAddress(line: string): string {
  const cleaned = line
    .normalize("NFKD")
    .toUpperCase()
    // Periods and commas are noise; hyphens are not, so they survive.
    .replace(/[.,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "";

  const tokens = cleaned.split(" ");
  const last = tokens.length - 1;

  return tokens
    .map((token, index) => {
      if (index === last) {
        const expanded = SUFFIXES[token];
        if (expanded) return expanded;
      }
      // The house number is whatever leads, and it is never a direction —
      // "10 EAST 10 STREET" must not turn its first token into anything.
      if (index > 0) {
        const direction = DIRECTIONS[token];
        if (direction) return direction;
      }
      return dropOrdinal(token, index);
    })
    .join(" ");
}

/**
 * `10TH` becomes `10`, but only past the first token.
 *
 * A house number is never an ordinal, and mangling one would be silent: PLUTO
 * would simply return nothing and the founder would be told their building is
 * not in the city's records.
 */
function dropOrdinal(token: string, index: number): string {
  if (index === 0) return token;
  const match = /^(\d+)(ST|ND|RD|TH)$/.exec(token);
  return match?.[1] ?? token;
}

/** PLUTO's two-letter borough code. */
export type Borough = "MANHATTAN" | "BROOKLYN" | "QUEENS" | "BRONX" | "STATEN_ISLAND";

const BOROUGH_CODES: Record<Borough, string> = {
  MANHATTAN: "MN",
  BROOKLYN: "BK",
  QUEENS: "QN",
  BRONX: "BX",
  STATEN_ISLAND: "SI",
};

export function boroughCode(borough: Borough): string {
  return BOROUGH_CODES[borough];
}

/**
 * PLUTO's community district, in the form a board would write it.
 *
 * The dataset packs the borough and the district into one number: `302` is
 * Brooklyn district 2, `413` is Queens 13. The seed writes them as `BK 06`, so
 * that is the shape this returns.
 */
export function communityDistrict(cd: string | null | undefined): string | null {
  if (!cd) return null;
  const digits = cd.trim();
  if (!/^\d{3}$/.test(digits)) return null;

  const boroughByDigit: Record<string, string> = {
    "1": "MN",
    "2": "BX",
    "3": "BK",
    "4": "QN",
    "5": "SI",
  };
  const prefix = boroughByDigit[digits[0] ?? ""];
  if (!prefix) return null;

  return `${prefix} ${digits.slice(1)}`;
}

/**
 * PLUTO stores BBL as a float in a string: `3003860014.00000000`.
 *
 * Ten digits, borough + block + lot, and the fractional part is an artefact of
 * the export rather than anything meaningful.
 */
export function normaliseBbl(value: string | null | undefined): string | null {
  if (!value) return null;
  const whole = value.trim().split(".")[0] ?? "";
  return /^\d{10}$/.test(whole) ? whole : null;
}
