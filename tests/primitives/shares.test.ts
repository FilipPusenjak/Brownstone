import { describe, expect, it } from "vitest";
import {
  MAJORITY,
  THREE_QUARTERS,
  TWO_THIRDS,
  allocateByShares,
  computeQuorum,
  meetsThreshold,
  resolutionPassed,
  sharesNeeded,
  totalShares,
  weightOf,
  type ShareHolding,
} from "~/lib/primitives/shares";

/** The Adelaide's real allocation: 1,200 shares across six units. */
const ADELAIDE: ShareHolding[] = [
  { unitId: "garden", shares: 180 },
  { unitId: "1f", shares: 260 },
  { unitId: "2f", shares: 240 },
  { unitId: "2r", shares: 150 },
  { unitId: "3r", shares: 210 },
  { unitId: "4f", shares: 160 },
];

/** Four of twelve units holding sixty per cent — the case head-counting breaks. */
const LOPSIDED: ShareHolding[] = [
  ...Array.from({ length: 4 }, (_, i) => ({ unitId: `big${i}`, shares: 150 })),
  ...Array.from({ length: 8 }, (_, i) => ({ unitId: `small${i}`, shares: 50 })),
];

describe("totalShares and weight", () => {
  it("sums the register", () => {
    expect(totalShares(ADELAIDE)).toEqual(1200);
  });

  it("reports a unit's weight in basis points", () => {
    expect(weightOf(260, 1200)).toEqual(2167);
    expect(weightOf(0, 1200)).toEqual(0);
  });

  it("does not divide by zero on an empty building", () => {
    expect(weightOf(100, 0)).toEqual(0);
    expect(meetsThreshold(100, 0, MAJORITY)).toBe(false);
  });
});

describe("meetsThreshold", () => {
  it("counts shares, not units", () => {
    // Four units out of twelve is a third of the building by head and sixty per
    // cent by shares. Counting heads produces the wrong answer twice over.
    const bigFour = LOPSIDED.filter((h) => h.unitId.startsWith("big"));
    expect(totalShares(bigFour)).toEqual(600);
    expect(totalShares(LOPSIDED)).toEqual(1000);
    expect(meetsThreshold(600, 1000, MAJORITY)).toBe(true);
    expect(bigFour.length / LOPSIDED.length).toBeLessThan(0.5);
  });

  it("is exact on the boundary", () => {
    // Two thirds of 1200 is exactly 800. Float arithmetic makes this 800.0000…1
    // and fails the very vote most likely to be contested.
    expect(meetsThreshold(800, 1200, TWO_THIRDS)).toBe(true);
    expect(meetsThreshold(799, 1200, TWO_THIRDS)).toBe(false);
  });

  it("treats a bare majority as more than half, not half", () => {
    expect(meetsThreshold(600, 1200, MAJORITY)).toBe(false);
    expect(meetsThreshold(601, 1200, MAJORITY)).toBe(true);
  });

  it("agrees with sharesNeeded at the boundary", () => {
    for (const threshold of [MAJORITY, TWO_THIRDS, THREE_QUARTERS]) {
      const needed = sharesNeeded(1200, threshold);
      expect(meetsThreshold(needed, 1200, threshold)).toBe(true);
      expect(meetsThreshold(needed - 1, 1200, threshold)).toBe(false);
    }
  });
});

describe("computeQuorum", () => {
  it("adds proxies to those present", () => {
    const result = computeQuorum({
      holdings: ADELAIDE,
      presentUnitIds: ["1f", "2f"],
      proxyUnitIds: ["3r"],
      threshold: MAJORITY,
    });

    expect(result.inPersonShares).toEqual(500);
    expect(result.proxyShares).toEqual(210);
    expect(result.presentShares).toEqual(710);
    expect(result.met).toBe(true);
  });

  it("counts a unit once when it is both present and proxied", () => {
    // A shareholder sends a proxy and then turns up anyway. Counting both
    // inflates the quorum that authorised everything passed that night.
    const result = computeQuorum({
      holdings: ADELAIDE,
      presentUnitIds: ["1f"],
      proxyUnitIds: ["1f"],
      threshold: MAJORITY,
    });

    expect(result.presentShares).toEqual(260);
    expect(result.proxyShares).toEqual(0);
  });

  it("ignores units that are not on the register", () => {
    const result = computeQuorum({
      holdings: ADELAIDE,
      presentUnitIds: ["1f", "a-unit-in-another-building"],
      proxyUnitIds: [],
      threshold: MAJORITY,
    });
    expect(result.presentShares).toEqual(260);
  });

  it("says how far short the room is", () => {
    const result = computeQuorum({
      holdings: ADELAIDE,
      presentUnitIds: ["garden", "2r"],
      proxyUnitIds: [],
      threshold: TWO_THIRDS,
    });

    expect(result.presentShares).toEqual(330);
    expect(result.requiredShares).toEqual(800);
    expect(result.shortBy).toEqual(470);
    expect(result.met).toBe(false);
  });

  it("reaches quorum on shares from a minority of units", () => {
    const result = computeQuorum({
      holdings: LOPSIDED,
      presentUnitIds: ["big0", "big1", "big2", "big3"],
      proxyUnitIds: [],
      threshold: MAJORITY,
    });
    expect(result.met).toBe(true);
    expect(result.presentBasisPoints).toEqual(6000);
  });

  it("is never short once met", () => {
    const result = computeQuorum({
      holdings: ADELAIDE,
      presentUnitIds: ADELAIDE.map((h) => h.unitId),
      proxyUnitIds: [],
      threshold: THREE_QUARTERS,
    });
    expect(result.met).toBe(true);
    expect(result.shortBy).toEqual(0);
  });
});

describe("resolutionPassed", () => {
  const tally = { sharesFor: 500, sharesAgainst: 300, sharesAbstain: 200 };

  it("measures against shares voted by default, excluding abstentions", () => {
    expect(resolutionPassed(tally, MAJORITY)).toBe(true);
  });

  it("can measure against everyone present, counting abstentions in the base", () => {
    // 500 of 1000 present is exactly half, which is not a majority.
    expect(resolutionPassed(tally, MAJORITY, "present")).toBe(false);
  });

  it("can measure against all outstanding shares", () => {
    expect(resolutionPassed(tally, MAJORITY, "outstanding", 1200)).toBe(false);
    expect(
      resolutionPassed({ ...tally, sharesFor: 900 }, MAJORITY, "outstanding", 1200),
    ).toBe(true);
  });

  it("fails rather than throwing when nobody voted", () => {
    expect(
      resolutionPassed({ sharesFor: 0, sharesAgainst: 0, sharesAbstain: 0 }, MAJORITY),
    ).toBe(false);
  });
});

describe("allocateByShares", () => {
  it("distributes in proportion to shares", () => {
    const allocation = allocateByShares(120_000, ADELAIDE);
    expect(allocation.get("1f")).toEqual(26_000);
    expect(allocation.get("2r")).toEqual(15_000);
  });

  it("always sums to exactly the amount assessed", () => {
    // Per-unit rounding loses or invents cents, and an assessment that does not
    // add up to what the board voted is one somebody disputes.
    for (const total of [100_000, 123_457, 999_999, 1, 7]) {
      const allocation = allocateByShares(total, ADELAIDE);
      const sum = [...allocation.values()].reduce((a, b) => a + b, 0);
      expect(sum, `total ${total}`).toEqual(total);
    }
  });

  it("gives remainder cents to the largest holders first", () => {
    const allocation = allocateByShares(7, ADELAIDE);
    const sum = [...allocation.values()].reduce((a, b) => a + b, 0);
    expect(sum).toEqual(7);
    // 1F holds the most shares, so it takes a remainder cent before 2R does.
    expect(allocation.get("1f") ?? 0).toBeGreaterThanOrEqual(allocation.get("2r") ?? 0);
  });

  it("returns nothing for a building with no shares", () => {
    expect(allocateByShares(1000, []).size).toEqual(0);
  });

  it("produces whole cents only", () => {
    for (const cents of allocateByShares(123_457, ADELAIDE).values()) {
      expect(Number.isInteger(cents)).toBe(true);
    }
  });
});
