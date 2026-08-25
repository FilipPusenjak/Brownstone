/**
 * Standing a building up for the first time.
 *
 * Every other primitive in this directory answers a question about a building
 * that already exists. This one answers the question before that: what is the
 * smallest set of facts that makes a co-op's record usable on day one, and what
 * can be proposed rather than demanded?
 *
 * The distinction matters more here than anywhere else in the product. A board
 * president signing up has, at that moment, roughly three minutes of patience
 * and possibly no paperwork in front of them. Ask for the share allocation from
 * the offering plan up front and they close the tab. Ask for nothing and the
 * building is founded on numbers that are quietly wrong, which is worse —
 * quorum, assessments and the work split are all share-weighted, so a
 * placeholder allocation silently corrupts the arithmetic the product exists to
 * get right.
 *
 * So: propose, mark the proposal as a proposal, and make the real numbers easy
 * to type over. Nothing here decides anything. It saves keystrokes and then
 * gets out of the way.
 */

import type { FloorNaming } from "~/lib/building/floors";

/**
 * The default per-apartment share count.
 *
 * A round hundred, deliberately. Shares only ever matter as proportions —
 * `weightOf` turns them into basis points and nothing in the system cares about
 * the total — so the default's only job is to be obviously a default. A board
 * looking at six apartments holding 100 shares each can see at a glance that
 * nobody has typed the offering plan in yet, in a way that 1000 split six ways
 * as 167/167/167/167/166/166 does not.
 */
export const DEFAULT_SHARES = 100;

/** The range the form accepts. Not a legal limit — a typo guard. */
export const MIN_APARTMENTS = 2;
export const MAX_APARTMENTS = 60;
export const MAX_STORIES = 30;

export interface ProposedApartment {
  readonly label: string;
  readonly floorIndex: number;
  /** "F" or "R" where a floor holds more than one apartment, else null. */
  readonly line: string | null;
  readonly shares: number;
}

/**
 * Where the apartments in a building of this shape probably are.
 *
 * A brownstone's lowest level is the garden floor, which is level 0 and is not
 * counted among its stories — a "four-storey brownstone" has five levels of
 * apartments. A numbered walk-up starts at 1, because a ground floor in that
 * kind of building is as likely to be a storefront as a home. Getting this
 * wrong produces a proposal a board member does not recognise, which is worse
 * than no proposal, so the two are handled separately rather than with an
 * offset.
 *
 * Apartments are spread bottom-up, because that is where the extra one goes in
 * practice: the garden and parlour floors are the ones that got subdivided.
 */
export function proposeApartments(input: {
  apartmentCount: number;
  stories: number;
  floorNaming: FloorNaming;
}): ProposedApartment[] {
  const count = Math.max(0, Math.floor(input.apartmentCount));
  if (count === 0) return [];

  const levels = levelsOf(input.stories, input.floorNaming);
  const perLevel = spread(count, levels.length);

  const out: ProposedApartment[] = [];
  for (const [index, floorIndex] of levels.entries()) {
    const onThisFloor = perLevel[index] ?? 0;
    for (let n = 0; n < onThisFloor; n += 1) {
      const line = onThisFloor > 1 ? (LINES[n] ?? String(n + 1)) : null;
      out.push({
        label: labelFor(floorIndex, line, input.floorNaming, onThisFloor),
        floorIndex,
        line,
        shares: DEFAULT_SHARES,
      });
    }
  }
  return out;
}

/**
 * Front and rear, then a third and fourth if a floor has been cut up further.
 *
 * F and R are what a brownstone says. A floor with three apartments has no
 * vernacular, so it falls back to letters, which every walk-up understands.
 */
const LINES = ["F", "R", "C", "D", "E"] as const;

function levelsOf(stories: number, naming: FloorNaming): number[] {
  const top = Math.max(1, Math.min(Math.floor(stories), MAX_STORIES));
  // Brownstone: garden (0) through the top storey — five levels on a
  // four-storey house. Numeric: 1 through the top, because the ground floor of
  // a walk-up is as likely to be a storefront as a home.
  const from = naming === "BROWNSTONE" ? 0 : 1;
  const levels: number[] = [];
  for (let i = from; i <= top; i += 1) levels.push(i);
  return levels;
}

/**
 * Distributes `count` apartments over `levels` floors, lowest floors first.
 *
 * Seven apartments over four floors is 2/2/2/1 and not 1/2/2/2: the remainder
 * lands at the bottom of the stack, where a brownstone's extra apartments
 * actually are.
 */
function spread(count: number, levels: number): number[] {
  if (levels <= 0) return [count];
  const base = Math.floor(count / levels);
  const extra = count % levels;
  return Array.from({ length: levels }, (_, i) => base + (i < extra ? 1 : 0));
}

function labelFor(
  floorIndex: number,
  line: string | null,
  naming: FloorNaming,
  onThisFloor: number,
): string {
  // The one apartment on a brownstone's garden level is "GARDEN", never "0F" —
  // it is the only floor whose name is also an apartment's name.
  if (naming === "BROWNSTONE" && floorIndex === 0 && onThisFloor === 1) {
    return "GARDEN";
  }
  return line ? `${floorIndex}${line}` : String(floorIndex);
}

/**
 * The building's name in a URL.
 *
 * Short, lowercase, and stripped of the articles a co-op puts in its name and
 * nobody types: "The Adelaide" is `adelaide`. Reserved words are refused rather
 * than mangled, because `/b/new` colliding with a route is the kind of thing
 * that works until the day somebody adds a page.
 */
const RESERVED = new Set([
  "new",
  "start",
  "api",
  "sign-in",
  "invite",
  "account",
  "b",
  "admin",
  "settings",
  "verify-request",
]);

export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    // Strip diacritics rather than dropping the letters they sit on, so
    // "Café Terrace" is `cafe-terrace` and not `caf-terrace`.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^(the|a|an)\s+/u, "")
    // Apostrophes close up rather than becoming a hyphen: "Mott's Landing" is
    // `motts-landing`, not `mott-s-landing`.
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

  return base;
}

export function slugIsUsable(slug: string): boolean {
  return slug.length >= 2 && slug.length <= 40 && !RESERVED.has(slug);
}

/**
 * A second, third and fourth candidate for when the first is taken.
 *
 * Slugs are unique across every building on the deployment, and row-level
 * security means the founder cannot be shown the list to pick around — so
 * collisions are discovered by the insert failing, and this supplies the next
 * thing to try. Suffixes are drawn from a shuffled alphabet rather than
 * counting upward: `adelaide-2` tells whoever typed it that exactly one other
 * Adelaide exists, and that is nobody's business.
 */
export function slugCandidates(slug: string, attempts: number): string[] {
  const out = [slug];
  for (let i = 1; i < attempts; i += 1) {
    const suffix = Math.random().toString(36).slice(2, 6);
    out.push(`${slug.slice(0, 40 - suffix.length - 1)}-${suffix}`);
  }
  return out;
}

export interface ApartmentInput {
  readonly label: string;
  readonly floorIndex: number;
  readonly line: string | null;
  readonly shares: number;
}

export interface ApartmentProblem {
  readonly index: number;
  readonly message: string;
}

/**
 * What is wrong with the apartment list, in the order a person would fix it.
 *
 * Returned rather than thrown, and reported per row, because this is the one
 * screen where a founder is typing twenty things at once and a single
 * "something is invalid" would send them hunting.
 */
export function checkApartments(
  apartments: readonly ApartmentInput[],
): ApartmentProblem[] {
  const problems: ApartmentProblem[] = [];

  if (apartments.length < MIN_APARTMENTS) {
    problems.push({
      index: -1,
      message: `A co-op needs at least ${MIN_APARTMENTS} apartments.`,
    });
  }
  if (apartments.length > MAX_APARTMENTS) {
    problems.push({
      index: -1,
      message: `${MAX_APARTMENTS} apartments is the most this form takes.`,
    });
  }

  const seen = new Map<string, number>();
  for (const [index, apartment] of apartments.entries()) {
    const label = apartment.label.trim();

    if (!label) {
      problems.push({ index, message: "Give the apartment a name." });
    } else {
      // Compared case-insensitively because the database's unique index is
      // not, and "2f" and "2F" being different apartments would be a trap.
      const key = label.toUpperCase();
      const first = seen.get(key);
      if (first !== undefined) {
        problems.push({ index, message: `Already used for apartment ${first + 1}.` });
      } else {
        seen.set(key, index);
      }
    }

    if (!Number.isInteger(apartment.shares) || apartment.shares <= 0) {
      problems.push({ index, message: "Shares must be a whole number above zero." });
    }
    if (!Number.isInteger(apartment.floorIndex) || apartment.floorIndex < 0) {
      problems.push({ index, message: "Floor must be zero or above." });
    }
  }

  return problems;
}

/** The note recorded against a founding share allocation. */
export const FOUNDING_ALLOCATION_NOTE =
  "Recorded when the building was set up. Replace with the offering plan's allocation.";

/**
 * Whether an allocation is still a placeholder rather than the real one.
 *
 * The signal is simply that every apartment holds the same number of shares.
 * Real allocations come from an offering plan and follow floor area, so a
 * garden apartment and a parlour floor holding identical shares is close to
 * unheard of — whereas it is exactly what this form proposes when nobody has
 * the plan to hand.
 *
 * An earlier version also required the figure to be a multiple of the default,
 * which was worse in the way that matters: a founder who replaced 100s with
 * 250s and stopped there would have had an untouched allocation reported as a
 * real one. The test that caught it is in `tests/founding/primitives.test.ts`.
 * A false positive here costs a board one glance at a note; a false negative
 * costs them a share-weighted vote counted on fiction.
 */
export function looksProvisional(shares: readonly number[]): boolean {
  if (shares.length < 2) return false;
  const first = shares[0];
  if (first === undefined) return false;
  return shares.every((value) => value === first);
}
