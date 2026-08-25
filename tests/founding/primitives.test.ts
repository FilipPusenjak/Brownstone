import { describe, expect, it } from "vitest";
import {
  checkApartments,
  DEFAULT_SHARES,
  looksProvisional,
  MAX_APARTMENTS,
  proposeApartments,
  slugCandidates,
  slugify,
  slugIsUsable,
  type ApartmentInput,
} from "~/lib/primitives/founding";

/**
 * What the founding form proposes, before anybody has typed anything.
 *
 * None of this decides anything — every value it produces is editable on the
 * screen that shows it. What it has to be is *recognisable*: a board member
 * looking at the proposed list should see their own building and correct two
 * rows, not delete the lot and start again. A proposal nobody recognises is
 * worse than an empty table, because it has to be undone first.
 */

function labels(input: {
  apartmentCount: number;
  stories: number;
  floorNaming: "BROWNSTONE" | "NUMERIC";
}): string[] {
  return proposeApartments(input).map((apartment) => apartment.label);
}

describe("proposing the apartments", () => {
  it("puts the garden apartment on the garden floor", () => {
    // The seeded Adelaide is exactly this shape: a garden apartment and then
    // front and rear on the floors above.
    expect(
      labels({ apartmentCount: 5, stories: 4, floorNaming: "BROWNSTONE" }),
    ).toEqual(["GARDEN", "1", "2", "3", "4"]);
  });

  it("counts a brownstone's garden level outside its storeys", () => {
    // A four-storey brownstone has five levels of apartments. Getting this
    // wrong crowds everybody one floor down and produces a stack nobody
    // recognises.
    const four = proposeApartments({
      apartmentCount: 5,
      stories: 4,
      floorNaming: "BROWNSTONE",
    });
    expect(four.map((a) => a.floorIndex)).toEqual([0, 1, 2, 3, 4]);
  });

  it("starts a walk-up at one", () => {
    // The ground floor of a numbered walk-up is as likely to be a storefront
    // as a home, so nothing is proposed there.
    const walkUp = proposeApartments({
      apartmentCount: 3,
      stories: 3,
      floorNaming: "NUMERIC",
    });
    expect(walkUp.map((a) => a.floorIndex)).toEqual([1, 2, 3]);
    expect(walkUp.map((a) => a.label)).toEqual(["1", "2", "3"]);
  });

  it("splits a floor into front and rear", () => {
    expect(
      labels({ apartmentCount: 6, stories: 2, floorNaming: "BROWNSTONE" }),
    ).toEqual(["0F", "0R", "1F", "1R", "2F", "2R"]);
  });

  it("puts the odd apartment at the bottom of the stack", () => {
    // Seven over four floors is 2/2/2/1 and not 1/2/2/2. The garden and parlor
    // floors are the ones that got subdivided; the top floor rarely is.
    const seven = proposeApartments({
      apartmentCount: 7,
      stories: 3,
      floorNaming: "BROWNSTONE",
    });
    const perFloor = new Map<number, number>();
    for (const apartment of seven) {
      perFloor.set(apartment.floorIndex, (perFloor.get(apartment.floorIndex) ?? 0) + 1);
    }
    expect([...perFloor.entries()].sort()).toEqual([
      [0, 2],
      [1, 2],
      [2, 2],
      [3, 1],
    ]);
  });

  it("falls back to letters where a floor was cut into three", () => {
    expect(labels({ apartmentCount: 3, stories: 1, floorNaming: "NUMERIC" })).toEqual([
      "1F",
      "1R",
      "1C",
    ]);
  });

  it("gives every apartment the same, obviously round, share count", () => {
    // The default's whole job is to look like a default. Six apartments at 100
    // shares each reads as "nobody has typed the offering plan in"; the same
    // six at 167/167/167/167/166/166 reads as a real allocation.
    const proposed = proposeApartments({
      apartmentCount: 6,
      stories: 4,
      floorNaming: "BROWNSTONE",
    });
    expect(proposed.map((a) => a.shares)).toEqual(Array(6).fill(DEFAULT_SHARES));
    expect(looksProvisional(proposed.map((a) => a.shares))).toBe(true);
  });

  it("never proposes two apartments with the same name", () => {
    for (const count of [2, 4, 5, 6, 9, 12, 20]) {
      for (const stories of [1, 2, 3, 4, 5, 6]) {
        for (const naming of ["BROWNSTONE", "NUMERIC"] as const) {
          const proposed = labels({
            apartmentCount: count,
            stories,
            floorNaming: naming,
          });
          expect(
            new Set(proposed).size,
            `${count} over ${stories} (${naming})`,
          ).toEqual(proposed.length);
        }
      }
    }
  });

  it("proposes nothing for a building with no apartments", () => {
    expect(
      proposeApartments({ apartmentCount: 0, stories: 4, floorNaming: "NUMERIC" }),
    ).toEqual([]);
  });
});

describe("a real allocation", () => {
  it("is not mistaken for the placeholder", () => {
    // Real allocations follow floor area, so they vary. The Adelaide's do.
    expect(looksProvisional([180, 260, 240, 150, 210, 160])).toBe(false);
    expect(looksProvisional([100, 100, 100, 101])).toBe(false);
  });

  it("catches a placeholder that isn't the one this form proposed", () => {
    // A founder who replaced the 100s with 250s and stopped has still not
    // typed an allocation. Anchoring the check to the default share count
    // would have called this a real one.
    expect(looksProvisional([250, 250, 250, 250])).toBe(true);
    expect(looksProvisional([37, 37, 37])).toBe(true);
    expect(looksProvisional([DEFAULT_SHARES, DEFAULT_SHARES])).toBe(true);
  });

  it("says nothing about a single apartment", () => {
    expect(looksProvisional([100])).toBe(false);
  });
});

describe("the building's web address", () => {
  it("drops the article a co-op puts in its name", () => {
    expect(slugify("The Adelaide")).toEqual("adelaide");
    expect(slugify("Lispenard House")).toEqual("lispenard-house");
  });

  it("closes up an apostrophe rather than breaking the word on it", () => {
    expect(slugify("Mott's Landing")).toEqual("motts-landing");
  });

  it("keeps the letter an accent sits on", () => {
    expect(slugify("Café Terrace")).toEqual("cafe-terrace");
  });

  it("refuses a name that would collide with a route", () => {
    // `/b/new` working until somebody adds a page called new is the kind of
    // bug that lands eighteen months later on a stranger.
    expect(slugIsUsable(slugify("New"))).toBe(false);
    expect(slugIsUsable(slugify("Account"))).toBe(false);
    expect(slugIsUsable(slugify("!!!"))).toBe(false);
    expect(slugIsUsable(slugify("A"))).toBe(false);
  });

  it("never ends in a hyphen, however it was truncated", () => {
    const long = slugify(`${"Bergen ".repeat(12)}Street`);
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith("-")).toBe(false);
  });

  it("offers alternatives that don't count the buildings ahead of you", () => {
    // `adelaide-2` would tell whoever typed it that exactly one other Adelaide
    // exists on this deployment, which is nobody's business — row-level
    // security hides those buildings everywhere else.
    const candidates = slugCandidates("adelaide", 4);
    expect(candidates[0]).toEqual("adelaide");
    expect(candidates).toHaveLength(4);
    expect(candidates.slice(1)).not.toContain("adelaide-2");
    for (const candidate of candidates) {
      expect(candidate.length).toBeLessThanOrEqual(40);
    }
  });
});

describe("checking the apartment list", () => {
  function apartment(overrides: Partial<ApartmentInput> = {}): ApartmentInput {
    return { label: "2F", floorIndex: 2, line: "F", shares: 100, ...overrides };
  }

  it("passes a list that is fine", () => {
    expect(
      checkApartments([apartment({ label: "1F" }), apartment({ label: "2F" })]),
    ).toEqual([]);
  });

  it("catches two apartments with the same name, whatever the casing", () => {
    // The database's unique index is case-sensitive, so "2f" and "2F" would be
    // accepted as different apartments and then be indistinguishable on every
    // screen in the product.
    const problems = checkApartments([
      apartment({ label: "2F" }),
      apartment({ label: "2f" }),
    ]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.index).toEqual(1);
    expect(problems[0]?.message).toContain("apartment 1");
  });

  it("points at the row that is wrong", () => {
    const problems = checkApartments([
      apartment({ label: "1F" }),
      apartment({ label: "" }),
      apartment({ label: "3F", shares: 0 }),
    ]);
    expect(problems.map((problem) => problem.index)).toEqual([1, 2]);
  });

  it("refuses fractional and negative shares", () => {
    expect(
      checkApartments([apartment(), apartment({ label: "3F", shares: 1.5 })]),
    ).toHaveLength(1);
    expect(
      checkApartments([apartment(), apartment({ label: "3F", shares: -10 })]),
    ).toHaveLength(1);
  });

  it("refuses a co-op of one", () => {
    const problems = checkApartments([apartment()]);
    expect(problems.some((problem) => problem.index === -1)).toBe(true);
  });

  it("refuses a list longer than the form takes", () => {
    const many = Array.from({ length: MAX_APARTMENTS + 1 }, (_, i) =>
      apartment({ label: `A${i}` }),
    );
    expect(checkApartments(many).some((problem) => problem.index === -1)).toBe(true);
  });
});
