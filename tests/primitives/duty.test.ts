import { describe, expect, it } from "vitest";
import {
  periodBounds,
  periodIndexOn,
  turnOn,
  turnsEach,
  turnsFrom,
  unitForPeriod,
  type Rotation,
} from "~/lib/primitives/duty";
import { addDays, makeDate } from "~/lib/time";

/**
 * Whose week was it.
 *
 * The boundaries are the whole test. A summons dated the changeover day has to
 * name one apartment and always the same one, because the alternative is two
 * neighbours each certain it was the other's week — which is the argument this
 * arithmetic exists to end.
 */

/** Six apartments, a week each, starting Monday 5 April 2027. */
const ROTATION: Rotation = {
  unitOrder: ["garden", "1f", "2f", "2r", "3r", "4f"],
  startsOn: makeDate(2027, 4, 5),
  periodDays: 7,
};

describe("the duty rotation", () => {
  describe("which period a date falls in", () => {
    it("starts at zero on the first day", () => {
      expect(periodIndexOn(ROTATION, makeDate(2027, 4, 5))).toEqual(0);
    });

    it("stays in period zero for the whole first week", () => {
      expect(periodIndexOn(ROTATION, makeDate(2027, 4, 11))).toEqual(0);
    });

    it("rolls over on the eighth day, not the seventh", () => {
      // 5 April + 7 days is 12 April, which is the *second* apartment's first
      // day. Getting this off by one blames the wrong neighbour every time a
      // fine lands on a changeover.
      expect(periodIndexOn(ROTATION, makeDate(2027, 4, 12))).toEqual(1);
    });

    it("has no answer before the rotation began", () => {
      expect(periodIndexOn(ROTATION, makeDate(2027, 4, 4))).toBeNull();
      expect(turnOn(ROTATION, makeDate(2027, 3, 1))).toBeNull();
    });

    it("refuses a period of zero days rather than dividing by it", () => {
      expect(
        periodIndexOn({ ...ROTATION, periodDays: 0 }, makeDate(2027, 6, 1)),
      ).toBeNull();
    });
  });

  describe("whose turn", () => {
    it("gives the first apartment the first week", () => {
      const turn = turnOn(ROTATION, makeDate(2027, 4, 7));
      expect(turn?.unitId).toEqual("garden");
      expect(turn?.start).toEqual(makeDate(2027, 4, 5));
      expect(turn?.end).toEqual(makeDate(2027, 4, 11));
    });

    it("wraps round the order", () => {
      // Six apartments, so period 6 is back to the first.
      expect(unitForPeriod(ROTATION, 5)).toEqual("4f");
      expect(unitForPeriod(ROTATION, 6)).toEqual("garden");
      expect(unitForPeriod(ROTATION, 13)).toEqual("1f");
    });

    it("names one apartment on a changeover day", () => {
      // 11 April is the last day of the first turn, 12 April the first of the
      // second. Neither date is ambiguous.
      expect(turnOn(ROTATION, makeDate(2027, 4, 11))?.unitId).toEqual("garden");
      expect(turnOn(ROTATION, makeDate(2027, 4, 12))?.unitId).toEqual("1f");
    });

    it("works months later without drifting", () => {
      // 2 August 2027 is 119 days in — exactly 17 whole weeks, so period 17,
      // which with six apartments is position 5.
      const turn = turnOn(ROTATION, makeDate(2027, 8, 2));
      expect(turn?.index).toEqual(17);
      expect(turn?.unitId).toEqual("4f");
    });

    it("has no turn when nobody is in the rotation", () => {
      expect(turnOn({ ...ROTATION, unitOrder: [] }, makeDate(2027, 6, 1))).toBeNull();
    });

    it("covers every day of a year exactly once", () => {
      // The periods must tile the calendar with no gap and no overlap: every
      // day's turn contains that day, and the turn only changes on a boundary.
      // A year crosses a daylight-saving change in both directions, which is
      // where millisecond arithmetic would slip a day.
      let previous = -1;
      for (let day = 0; day < 365; day += 1) {
        const date = addDays(ROTATION.startsOn, day);
        const turn = turnOn(ROTATION, date)!;

        expect(turn.start <= date && date <= turn.end).toBe(true);
        expect(turn.index).toEqual(Math.floor(day / 7));
        expect(turn.index).toBeGreaterThanOrEqual(previous);
        previous = turn.index;
      }
    });
  });

  describe("the periods themselves", () => {
    it("runs from the start day to the day before the next one", () => {
      expect(periodBounds(ROTATION, 0)).toEqual({
        start: makeDate(2027, 4, 5),
        end: makeDate(2027, 4, 11),
      });
      expect(periodBounds(ROTATION, 1)).toEqual({
        start: makeDate(2027, 4, 12),
        end: makeDate(2027, 4, 18),
      });
    });

    it("handles a fortnightly rotation", () => {
      const fortnightly = { ...ROTATION, periodDays: 14 };
      expect(periodBounds(fortnightly, 1)).toEqual({
        start: makeDate(2027, 4, 19),
        end: makeDate(2027, 5, 2),
      });
      expect(turnOn(fortnightly, makeDate(2027, 4, 19))?.unitId).toEqual("1f");
    });
  });

  describe("turns ahead", () => {
    it("starts from the turn the date falls in", () => {
      const turns = turnsFrom(ROTATION, makeDate(2027, 4, 14), 3);
      expect(turns.map((t) => t.unitId)).toEqual(["1f", "2f", "2r"]);
      expect(turns[0]?.start).toEqual(makeDate(2027, 4, 12));
    });

    it("begins at the first period when the rotation has not started", () => {
      const turns = turnsFrom(ROTATION, makeDate(2027, 1, 1), 2);
      expect(turns[0]?.index).toEqual(0);
      expect(turns[0]?.unitId).toEqual("garden");
    });

    it("returns nothing for a rotation with nobody in it", () => {
      expect(turnsFrom({ ...ROTATION, unitOrder: [] }, ROTATION.startsOn, 5)).toEqual(
        [],
      );
    });
  });

  describe("counting turns", () => {
    it("shares them evenly over a whole number of cycles", () => {
      const counts = turnsEach(ROTATION, 0, 11); // two full cycles of six
      expect([...counts.values()]).toEqual([2, 2, 2, 2, 2, 2]);
    });

    it("shows who got the extra turn when it does not divide", () => {
      // Eight periods across six apartments: everyone gets one, and the two at
      // the front of the order get a second. The imbalance is real and evens
      // out over time — showing it is how that argument gets settled without
      // anybody counting on their fingers.
      const counts = turnsEach(ROTATION, 0, 7);
      expect(counts.get("garden")).toEqual(2);
      expect(counts.get("1f")).toEqual(2);
      expect(counts.get("2f")).toEqual(1);
      expect(counts.get("4f")).toEqual(1);
      expect([...counts.values()].reduce((a, b) => a + b, 0)).toEqual(8);
    });
  });
});
