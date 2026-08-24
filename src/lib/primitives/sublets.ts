import { compareDates, type PlainDate } from "~/lib/time";

/**
 * The sublet cap, and when a term is running.
 *
 * A proprietary lease usually caps how much of the building may be sublet at
 * once — "not more than twenty per cent of the apartments" — and the number
 * matters beyond the house rules. A co-op that drifts over its cap can lose
 * lending eligibility for every shareholder trying to sell, because Fannie Mae
 * limits how much of a building may be non-owner-occupied. It is exactly the
 * sort of figure a volunteer board loses track of across a turnover, and
 * exactly the sort a spreadsheet gets subtly wrong.
 *
 * So the arithmetic is here, exact and tested, rather than inline at the one
 * call site that happens to need it today.
 */

export interface Term {
  readonly start: PlainDate;
  readonly end: PlainDate;
  /** Set when a sublet ended early — the subtenant left before the term ran out. */
  readonly endedOn?: PlainDate | null;
}

/**
 * The most apartments that may be sublet at once.
 *
 * Compared by cross-multiplication, never by computing a percentage. Twenty per
 * cent of six apartments is 1.2, and the question "may a second apartment be
 * sublet" has to be answered without ever producing 1.2 — a float comparison
 * that rounds it to 1 is right by accident, and one that rounds to 2 lets the
 * building breach its own lease.
 *
 * "Not more than" is inclusive: twenty per cent of ten apartments is exactly
 * two, and two is allowed. The boundary case is the one a shareholder whose
 * application was refused will do the arithmetic on.
 */
export function capCount(totalUnits: number, capPercent: number | null): number | null {
  if (capPercent === null) return null;
  if (totalUnits <= 0) return 0;
  return Math.floor((totalUnits * capPercent) / 100);
}

/**
 * Whether `count` apartments being sublet is within the cap.
 *
 * `count * 100 <= totalUnits * capPercent`, so nothing is divided and nothing
 * is rounded anywhere in the comparison. A null cap means the lease sets none.
 */
export function withinCap(
  count: number,
  totalUnits: number,
  capPercent: number | null,
): boolean {
  if (capPercent === null) return true;
  return count * 100 <= totalUnits * capPercent;
}

/** Whether a term covers a date, accounting for an early end. */
export function isRunningOn(term: Term, date: PlainDate): boolean {
  if (compareDates(date, term.start) < 0) return false;
  if (compareDates(date, term.end) > 0) return false;
  // An early end stops it from that day on; the last day it ran was the day
  // before, which is what "ended on the 3rd" means to the person who left.
  if (term.endedOn && compareDates(date, term.endedOn) >= 0) return false;
  return true;
}

/**
 * Whether two terms overlap at all.
 *
 * Used to stop one apartment holding two sublets at the same time. Inclusive at
 * both ends: a term ending the same day another begins is an overlap, because
 * on that day the apartment has two subtenants on paper.
 */
export function termsOverlap(a: Term, b: Term): boolean {
  const aEnd = earlier(a.end, a.endedOn);
  const bEnd = earlier(b.end, b.endedOn);
  return compareDates(a.start, bEnd) <= 0 && compareDates(b.start, aEnd) <= 0;
}

function earlier(end: PlainDate, endedOn: PlainDate | null | undefined): PlainDate {
  if (!endedOn) return end;
  return compareDates(endedOn, end) < 0 ? endedOn : end;
}

export interface CapReading {
  readonly totalUnits: number;
  readonly capPercent: number | null;
  /** How many apartments are sublet right now. */
  readonly current: number;
  /** The most that may be, or null when the lease sets no cap. */
  readonly allowed: number | null;
  /** Whether one more would still be within the cap. */
  readonly roomForOneMore: boolean;
}

export function readCap(input: {
  totalUnits: number;
  capPercent: number | null;
  current: number;
}): CapReading {
  return {
    totalUnits: input.totalUnits,
    capPercent: input.capPercent,
    current: input.current,
    allowed: capCount(input.totalUnits, input.capPercent),
    roomForOneMore: withinCap(input.current + 1, input.totalUnits, input.capPercent),
  };
}
