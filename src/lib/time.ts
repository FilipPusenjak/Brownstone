import { format, isValid, parseISO } from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

/**
 * Dates, and the distinction this product cannot get wrong.
 *
 * There are two kinds of time here:
 *
 *   Instants — when an email was dispatched, when a decision was recorded.
 *   Stored as UTC timestamps, displayed in the building's timezone.
 *
 *   Civil dates — when a filing is due. "March 1" is a date on a wall calendar.
 *   It is not an instant, it has no timezone, and storing it as one produces a
 *   calendar that is off by a day for five months of the year, starting the
 *   Sunday in November when the clocks change. These are `@db.Date` columns and
 *   are handled here as `PlainDate` strings: "2026-03-01".
 *
 * Every building carries its own timezone column, but every building is in New
 * York, so this is the default rather than a parameter people must remember.
 */

export const NYC = "America/New_York";

/** An ISO calendar date with no time and no zone: "2026-03-01". */
export type PlainDate = string & { readonly __plainDate: unique symbol };

const PLAIN_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function plainDate(value: string): PlainDate {
  if (!PLAIN_DATE.test(value) || !isValid(parseISO(value))) {
    throw new TypeError(`Not a calendar date (expected YYYY-MM-DD): ${value}`);
  }
  return value as PlainDate;
}

export function isPlainDate(value: string): value is PlainDate {
  return PLAIN_DATE.test(value) && isValid(parseISO(value));
}

/** Today in the building's timezone — not the server's, which is UTC on Vercel. */
export function today(timeZone: string = NYC): PlainDate {
  return formatInTimeZone(new Date(), timeZone, "yyyy-MM-dd") as PlainDate;
}

/**
 * Converts a `@db.Date` column to a PlainDate.
 *
 * Postgres hands back a Date at UTC midnight. Reading it with local getters in
 * a timezone behind UTC yields the previous day, which is exactly the bug this
 * module exists to prevent, so the UTC components are used explicitly.
 */
export function toPlainDate(value: Date): PlainDate {
  return format(
    new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    ),
    "yyyy-MM-dd",
  ) as PlainDate;
}

/** Converts a PlainDate to the UTC-midnight Date a `@db.Date` column expects. */
export function toDbDate(value: PlainDate): Date {
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d));
}

/** Calendar arithmetic that never touches a timezone. */
export function addDays(date: PlainDate, days: number): PlainDate {
  const d = toDbDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return toPlainDate(d);
}

export function addMonths(date: PlainDate, months: number): PlainDate {
  const d = toDbDate(date);
  const targetMonth = d.getUTCMonth() + months;
  const day = d.getUTCDate();

  d.setUTCDate(1);
  d.setUTCMonth(targetMonth);

  // Clamp: one month after 31 January is 28 February, not 3 March. Rolling over
  // would silently move a filing deadline into the next month.
  const lastDay = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));

  return toPlainDate(d);
}

export function addYears(date: PlainDate, years: number): PlainDate {
  return addMonths(date, years * 12);
}

/** Positive when `a` is later than `b`. */
export function compareDates(a: PlainDate, b: PlainDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Whole days from `from` to `to`. Negative when `to` is in the past. */
export function daysBetween(from: PlainDate, to: PlainDate): number {
  const ms = toDbDate(to).getTime() - toDbDate(from).getTime();
  return Math.round(ms / 86_400_000);
}

export function makeDate(year: number, month: number, day: number): PlainDate {
  return plainDate(
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  );
}

export function yearOf(date: PlainDate): number {
  return Number(date.slice(0, 4));
}

// --- Display ---------------------------------------------------------------

/** "1 Mar 2026" — unambiguous, and short enough for a table cell. */
export function formatDate(date: PlainDate): string {
  return format(toDbDate(date), "d MMM yyyy");
}

/** "Sunday, 1 March 2026" — for a detail page where there is room to be clear. */
export function formatDateLong(date: PlainDate): string {
  return format(toDbDate(date), "EEEE, d MMMM yyyy");
}

/** An instant, in the building's timezone: "1 Mar 2026, 4:12 PM". */
export function formatInstant(value: Date, timeZone: string = NYC): string {
  return formatInTimeZone(value, timeZone, "d MMM yyyy, h:mm a");
}

/**
 * "in 9 days" / "6 days ago". Copy elsewhere puts this in a sentence a board
 * member would actually say: "Boiler inspection due in 9 days."
 */
export function relativeDays(from: PlainDate, to: PlainDate): string {
  const days = daysBetween(from, to);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";

  // Counted from the same `daysBetween` the rest of the product uses. A
  // duration formatter would round here and print "in 24 days" for a date 23
  // days away, and a compliance calendar that is off by one is worse than one
  // that says nothing — someone will plan a filing around it.
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}

/** "1 day" / "7 days". Small, but "1 days before" reads as a bug to a reader. */
export function pluralDays(count: number): string {
  return count === 1 ? "1 day" : `${count} days`;
}

/** An instant from a wall-clock time in the building's timezone. */
export function instantAt(
  date: PlainDate,
  time: string,
  timeZone: string = NYC,
): Date {
  return fromZonedTime(`${date}T${time}`, timeZone);
}

/** The building-local wall clock for an instant. */
export function localWallClock(value: Date, timeZone: string = NYC): Date {
  return toZonedTime(value, timeZone);
}
