import { describe, expect, it } from "vitest";
import {
  describeSlot,
  overlaps,
  slotCount,
  slotMinutes,
  slotsCovered,
  slotsOn,
  windowFor,
  type SlotShape,
} from "~/lib/primitives/bookings";
import { makeDate, NYC } from "~/lib/time";

/**
 * The calendar's arithmetic.
 *
 * Two things carry the whole file. Slots come off the wall clock, so the two
 * Sundays a year the clocks move do not shift the freight elevator's opening
 * hour; and the overlap test is half-open, so a move that runs from eight to
 * noon does not block the one that starts at noon.
 */

/** Four-hour slots, eight in the morning to eight at night: three a day. */
const ELEVATOR: SlotShape = {
  slotMinutes: 240,
  opensMinute: 8 * 60,
  closesMinute: 20 * 60,
};

describe("slots", () => {
  it("fits whole slots into the opening hours and no partial one", () => {
    expect(slotCount(ELEVATOR)).toEqual(3);
    // Nine hours open, four-hour slots: two bookings and an hour spare, not
    // two and a quarter.
    expect(slotCount({ ...ELEVATOR, closesMinute: 17 * 60 })).toEqual(2);
  });

  it("has none at all when the resource never opens", () => {
    expect(slotCount({ ...ELEVATOR, closesMinute: ELEVATOR.opensMinute })).toEqual(0);
    expect(slotCount({ ...ELEVATOR, slotMinutes: 0 })).toEqual(0);
    expect(slotsOn({ ...ELEVATOR, slotMinutes: 0 }, makeDate(2027, 6, 1), NYC)).toEqual(
      [],
    );
  });

  it("runs from the opening minute, not from midnight", () => {
    expect(slotMinutes(ELEVATOR, 0)).toEqual({ startMinute: 480, endMinute: 720 });
    expect(slotMinutes(ELEVATOR, 2)).toEqual({ startMinute: 960, endMinute: 1200 });
  });

  it("has no slot beyond the last one", () => {
    expect(slotMinutes(ELEVATOR, 3)).toBeNull();
    expect(slotMinutes(ELEVATOR, -1)).toBeNull();
  });

  it("names the hours the way somebody would say them", () => {
    expect(describeSlot(ELEVATOR, 0)).toEqual("8:00 AM – 12:00 PM");
    expect(describeSlot(ELEVATOR, 1)).toEqual("12:00 PM – 4:00 PM");
    expect(describeSlot({ ...ELEVATOR, opensMinute: 0 }, 0)).toEqual(
      "12:00 AM – 4:00 AM",
    );
  });
});

describe("slots on a day", () => {
  it("puts the first slot at the local opening hour", () => {
    const [first] = slotsOn(ELEVATOR, makeDate(2027, 6, 15), NYC);
    // June, so New York is four hours behind UTC.
    expect(first?.startsAt.toISOString()).toEqual("2027-06-15T12:00:00.000Z");
    expect(first?.endsAt.toISOString()).toEqual("2027-06-15T16:00:00.000Z");
  });

  it("keeps opening at eight through a clock change", () => {
    // 14 March 2027 is the spring-forward Sunday and 7 November the fall-back
    // one. Both days still open at eight in the morning locally, at different
    // UTC instants — which is exactly what adding milliseconds to midnight
    // would get wrong.
    const spring = slotsOn(ELEVATOR, makeDate(2027, 3, 14), NYC)[0];
    const autumn = slotsOn(ELEVATOR, makeDate(2027, 11, 7), NYC)[0];

    expect(spring?.startsAt.toISOString()).toEqual("2027-03-14T12:00:00.000Z");
    expect(autumn?.startsAt.toISOString()).toEqual("2027-11-07T13:00:00.000Z");
  });

  it("leaves no gap between one slot and the next", () => {
    const slots = slotsOn(ELEVATOR, makeDate(2027, 6, 15), NYC);
    for (let index = 1; index < slots.length; index += 1) {
      expect(slots[index]!.startsAt.getTime()).toEqual(
        slots[index - 1]!.endsAt.getTime(),
      );
    }
  });
});

describe("a run of slots", () => {
  it("covers from the first slot's start to the last one's end", () => {
    const window = windowFor(ELEVATOR, makeDate(2027, 6, 15), NYC, 0, 2)!;
    expect(window.startsAt.toISOString()).toEqual("2027-06-15T12:00:00.000Z");
    expect(window.endsAt.toISOString()).toEqual("2027-06-15T20:00:00.000Z");
  });

  it("refuses a run that would spill past closing rather than shortening it", () => {
    // Two slots left and three asked for. Handing back two books half a move.
    expect(windowFor(ELEVATOR, makeDate(2027, 6, 15), NYC, 1, 3)).toBeNull();
    expect(windowFor(ELEVATOR, makeDate(2027, 6, 15), NYC, 3, 1)).toBeNull();
  });

  it("refuses a run of no slots at all", () => {
    expect(windowFor(ELEVATOR, makeDate(2027, 6, 15), NYC, 0, 0)).toBeNull();
    expect(windowFor(ELEVATOR, makeDate(2027, 6, 15), NYC, 0, -1)).toBeNull();
    expect(windowFor(ELEVATOR, makeDate(2027, 6, 15), NYC, 0, 1.5)).toBeNull();
  });

  it("never straddles midnight, whatever is asked for", () => {
    // The whole day as one slot shape: three slots is still one day.
    const allDay: SlotShape = { slotMinutes: 480, opensMinute: 0, closesMinute: 1440 };
    const window = windowFor(allDay, makeDate(2027, 6, 15), NYC, 0, 3)!;
    expect(window.endsAt.toISOString()).toEqual("2027-06-16T04:00:00.000Z");
    // Midnight local on the 16th — the end of the 15th, not a slot on the 16th.
    expect(windowFor(allDay, makeDate(2027, 6, 15), NYC, 1, 3)).toBeNull();
  });
});

describe("collisions", () => {
  const at = (iso: string) => new Date(iso);

  it("does not treat back-to-back bookings as a clash", () => {
    // The normal case for a long move: two neighbours, consecutive slots.
    const morning = {
      startsAt: at("2027-06-15T12:00:00Z"),
      endsAt: at("2027-06-15T16:00:00Z"),
    };
    const afternoon = {
      startsAt: at("2027-06-15T16:00:00Z"),
      endsAt: at("2027-06-15T20:00:00Z"),
    };
    expect(overlaps(morning, afternoon)).toBe(false);
    expect(overlaps(afternoon, morning)).toBe(false);
  });

  it("catches a booking that starts inside another", () => {
    const booked = {
      startsAt: at("2027-06-15T12:00:00Z"),
      endsAt: at("2027-06-15T20:00:00Z"),
    };
    const inside = {
      startsAt: at("2027-06-15T14:00:00Z"),
      endsAt: at("2027-06-15T16:00:00Z"),
    };
    expect(overlaps(booked, inside)).toBe(true);
    expect(overlaps(inside, booked)).toBe(true);
  });

  it("catches one that swallows another whole", () => {
    const short = {
      startsAt: at("2027-06-15T14:00:00Z"),
      endsAt: at("2027-06-15T15:00:00Z"),
    };
    const long = {
      startsAt: at("2027-06-15T12:00:00Z"),
      endsAt: at("2027-06-15T20:00:00Z"),
    };
    expect(overlaps(short, long)).toBe(true);
  });

  it("says which of the day's slots a booking takes", () => {
    const date = makeDate(2027, 6, 15);
    const window = windowFor(ELEVATOR, date, NYC, 1, 2)!;
    expect(slotsCovered(ELEVATOR, date, NYC, window)).toEqual([1, 2]);
  });
});
