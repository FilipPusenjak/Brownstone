import { describe, expect, it } from "vitest";
import {
  capCount,
  isRunningOn,
  readCap,
  termsOverlap,
  withinCap,
} from "~/lib/primitives/sublets";
import { makeDate } from "~/lib/time";

/**
 * The sublet cap arithmetic.
 *
 * Two things are worth testing here and they are both boundaries: the case
 * where the percentage does not divide evenly into the apartment count, and the
 * case where it divides exactly. A shareholder whose application is refused
 * will do this arithmetic themselves, and they will do it on the boundary.
 */

describe("the sublet cap", () => {
  describe("how many are allowed", () => {
    it("rounds down when the percentage does not divide evenly", () => {
      // The Adelaide: six apartments, twenty per cent. 1.2 apartments cannot be
      // sublet, so one can.
      expect(capCount(6, 20)).toEqual(1);
      expect(withinCap(1, 6, 20)).toBe(true);
      expect(withinCap(2, 6, 20)).toBe(false);
    });

    it("allows exactly the cap when it divides evenly", () => {
      // Ten apartments, twenty per cent, is exactly two — and "not more than
      // twenty per cent" includes twenty per cent.
      expect(capCount(10, 20)).toEqual(2);
      expect(withinCap(2, 10, 20)).toBe(true);
      expect(withinCap(3, 10, 20)).toBe(false);
    });

    it("never produces a fractional apartment on the way", () => {
      // Every cap from 1% to 100% across plausible building sizes: the count
      // allowed must equal the largest n that passes the comparison. If the
      // two ever disagree, one of them is doing float arithmetic.
      for (let units = 1; units <= 40; units += 1) {
        for (let percent = 1; percent <= 100; percent += 1) {
          const allowed = capCount(units, percent)!;
          expect(withinCap(allowed, units, percent)).toBe(true);
          expect(withinCap(allowed + 1, units, percent)).toBe(false);
        }
      }
    });

    it("treats no cap as no limit", () => {
      expect(capCount(6, null)).toBeNull();
      expect(withinCap(6, 6, null)).toBe(true);
    });

    it("reads the whole picture in one go", () => {
      const reading = readCap({ totalUnits: 6, capPercent: 20, current: 1 });
      expect(reading.allowed).toEqual(1);
      expect(reading.roomForOneMore).toBe(false);

      const empty = readCap({ totalUnits: 6, capPercent: 20, current: 0 });
      expect(empty.roomForOneMore).toBe(true);
    });
  });

  describe("when a term is running", () => {
    const term = {
      start: makeDate(2027, 4, 1),
      end: makeDate(2028, 3, 31),
    };

    it("covers its own dates, inclusive at both ends", () => {
      expect(isRunningOn(term, makeDate(2027, 4, 1))).toBe(true);
      expect(isRunningOn(term, makeDate(2027, 10, 15))).toBe(true);
      expect(isRunningOn(term, makeDate(2028, 3, 31))).toBe(true);
    });

    it("does not cover the day before or the day after", () => {
      expect(isRunningOn(term, makeDate(2027, 3, 31))).toBe(false);
      expect(isRunningOn(term, makeDate(2028, 4, 1))).toBe(false);
    });

    it("stops on the day the subtenant left", () => {
      const cutShort = { ...term, endedOn: makeDate(2027, 9, 1) };

      expect(isRunningOn(cutShort, makeDate(2027, 8, 31))).toBe(true);
      // The apartment is free again from that day, which is what frees the cap
      // slot for the neighbour waiting on an answer.
      expect(isRunningOn(cutShort, makeDate(2027, 9, 1))).toBe(false);
      expect(isRunningOn(cutShort, makeDate(2027, 10, 1))).toBe(false);
    });
  });

  describe("overlapping terms", () => {
    const first = { start: makeDate(2027, 1, 1), end: makeDate(2027, 6, 30) };

    it("catches a term that starts inside another", () => {
      expect(
        termsOverlap(first, {
          start: makeDate(2027, 6, 1),
          end: makeDate(2027, 12, 1),
        }),
      ).toBe(true);
    });

    it("catches one that swallows another whole", () => {
      expect(
        termsOverlap(first, { start: makeDate(2026, 1, 1), end: makeDate(2028, 1, 1) }),
      ).toBe(true);
    });

    it("counts a same-day handover as an overlap", () => {
      // On 30 June the apartment has two subtenants on paper, which is the
      // thing worth refusing.
      expect(
        termsOverlap(first, {
          start: makeDate(2027, 6, 30),
          end: makeDate(2027, 12, 1),
        }),
      ).toBe(true);
    });

    it("allows a term beginning the day after", () => {
      expect(
        termsOverlap(first, {
          start: makeDate(2027, 7, 1),
          end: makeDate(2027, 12, 1),
        }),
      ).toBe(false);
    });

    it("stops overlapping once the first one ended early", () => {
      const cutShort = { ...first, endedOn: makeDate(2027, 3, 1) };
      expect(
        termsOverlap(cutShort, {
          start: makeDate(2027, 4, 1),
          end: makeDate(2027, 12, 1),
        }),
      ).toBe(false);
    });
  });
});
