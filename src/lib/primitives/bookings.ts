import { addDays, instantAt, type PlainDate } from "~/lib/time";

/**
 * Slots, and the day they belong to.
 *
 * A booking is not an arbitrary pair of timestamps. It is a run of consecutive
 * slots on one local day, on a resource whose slot length and opening hours are
 * rows in the database rather than constants in this file — which is what makes
 * "adding the roof deck is data, not code" true for its calendar as well as for
 * its conditions.
 *
 * Two consequences worth stating, because they are the reason this is a
 * primitive and not three lines inside the write path.
 *
 * **Slots are built from the wall clock, not from elapsed milliseconds.** The
 * freight elevator opens at eight in the morning, and eight in the morning is a
 * different number of hours after midnight on the two Sundays a year the clocks
 * move. Adding `8 * 60 * 60 * 1000` to midnight gets one of those two days
 * wrong, and the day it gets wrong is the day somebody's movers are turned away
 * at the door.
 *
 * **A booking cannot straddle midnight.** Every slot is generated inside one
 * local day, so an overnight run is not something a caller can express. That is
 * deliberate: "which day was the elevator booked?" has to have one answer, and
 * a booking from 10pm to 2am has two.
 */

export interface SlotShape {
  /** How long one slot runs. */
  readonly slotMinutes: number;
  /** Minutes past local midnight when the first slot may start. */
  readonly opensMinute: number;
  /** Minutes past local midnight by which the last slot must have ended. */
  readonly closesMinute: number;
}

export interface Slot {
  readonly index: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface Interval {
  readonly startsAt: Date;
  readonly endsAt: Date;
}

/**
 * How many slots a day holds.
 *
 * A resource whose opening hours do not divide evenly by its slot length gets
 * the whole slots that fit and no partial one at the end. A three-hour slot in
 * an eight-hour day is two bookings and two spare hours, not two and two
 * thirds.
 */
export function slotCount(shape: SlotShape): number {
  if (shape.slotMinutes <= 0) return 0;
  const open = closesAt(shape) - opensAt(shape);
  if (open <= 0) return 0;
  return Math.floor(open / shape.slotMinutes);
}

/**
 * Opening and closing minutes, clamped to the day.
 *
 * These come out of the database, and a row claiming a resource opens at minus
 * three or closes at twenty-five o'clock would otherwise generate slots on a
 * day that does not exist.
 */
const MINUTES_IN_A_DAY = 24 * 60;

function opensAt(shape: SlotShape): number {
  return Math.min(Math.max(shape.opensMinute, 0), MINUTES_IN_A_DAY);
}

function closesAt(shape: SlotShape): number {
  return Math.min(Math.max(shape.closesMinute, 0), MINUTES_IN_A_DAY);
}

/** The minute a slot starts and ends, counted from local midnight. */
export function slotMinutes(
  shape: SlotShape,
  index: number,
): { startMinute: number; endMinute: number } | null {
  if (!Number.isInteger(index) || index < 0 || index >= slotCount(shape)) return null;
  const startMinute = opensAt(shape) + index * shape.slotMinutes;
  return { startMinute, endMinute: startMinute + shape.slotMinutes };
}

/**
 * The instant a minute past local midnight falls on.
 *
 * Minute 1440 is midnight at the *end* of the day, which is midnight at the
 * start of the next one. Writing it as "24:00" and handing that to a date
 * parser gets midnight at the start of the same day — a booking that ends
 * twenty-four hours before it begins. A resource open until midnight is an
 * ordinary thing for a roof deck, so this is not a corner worth leaving sharp.
 */
function instantAtMinute(date: PlainDate, minute: number, timeZone: string): Date {
  const day = minute >= MINUTES_IN_A_DAY ? addDays(date, 1) : date;
  const withinDay = minute % MINUTES_IN_A_DAY;
  const hours = Math.floor(withinDay / 60);
  const minutes = withinDay % 60;
  const clock = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:00`;
  return instantAt(day, clock, timeZone);
}

/** Every slot a day offers, as instants in the building's timezone. */
export function slotsOn(shape: SlotShape, date: PlainDate, timeZone: string): Slot[] {
  return Array.from({ length: slotCount(shape) }, (_, index) => {
    const bounds = slotMinutes(shape, index)!;
    return {
      index,
      startsAt: instantAtMinute(date, bounds.startMinute, timeZone),
      endsAt: instantAtMinute(date, bounds.endMinute, timeZone),
    };
  });
}

/**
 * The window a run of consecutive slots covers, or null if it does not fit.
 *
 * Returning null rather than clamping is the point: a caller asking for three
 * slots when two remain has asked for something the day cannot give, and
 * quietly handing back two would book half a move.
 */
export function windowFor(
  shape: SlotShape,
  date: PlainDate,
  timeZone: string,
  index: number,
  slots: number,
): Interval | null {
  if (!Number.isInteger(slots) || slots < 1) return null;
  const first = slotMinutes(shape, index);
  const last = slotMinutes(shape, index + slots - 1);
  if (!first || !last) return null;

  return {
    startsAt: instantAtMinute(date, first.startMinute, timeZone),
    endsAt: instantAtMinute(date, last.endMinute, timeZone),
  };
}

/**
 * Whether two windows collide.
 *
 * Half-open: a booking ending at noon and one starting at noon do not overlap.
 * Treating the boundary as a collision would make consecutive slots
 * unbookable, which is the normal case for a long move.
 */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startsAt < b.endsAt && b.startsAt < a.endsAt;
}

/** Which of a day's slots a window covers. Powers the calendar's shading. */
export function slotsCovered(
  shape: SlotShape,
  date: PlainDate,
  timeZone: string,
  window: Interval,
): number[] {
  return slotsOn(shape, date, timeZone)
    .filter((slot) => overlaps(slot, window))
    .map((slot) => slot.index);
}

/** "8:00 AM – 12:00 PM", from the wall clock rather than from a locale guess. */
export function describeSlot(shape: SlotShape, index: number): string {
  const bounds = slotMinutes(shape, index);
  if (!bounds) return "";
  return `${clockLabel(bounds.startMinute)} – ${clockLabel(bounds.endMinute)}`;
}

function clockLabel(minute: number): string {
  const hours24 = Math.floor(minute / 60) % 24;
  const minutes = minute % 60;
  const suffix = hours24 < 12 ? "AM" : "PM";
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}
