import type { PlainDate } from "~/lib/time";
import { addMonths, addYears, compareDates, daysBetween, makeDate, yearOf } from "~/lib/time";

/**
 * When is it due next?
 *
 * Four shapes of recurrence, because building compliance genuinely has four and
 * a cron string expresses only one of them:
 *
 *   NONE                    a one-off. File it once.
 *   FIXED_INTERVAL          every N months, optionally pinned to a calendar
 *                           date — "register with HPD by 1 September, yearly".
 *   CYCLICAL_BY_YEAR        the city assigns your building a year in a cycle
 *                           and everyone in that group files together —
 *                           facades by block, gas piping by community district.
 *   ANCHORED_TO_COMPLETION  N months after the last one *passed*. The elevator
 *                           Category 5 test is due five years after the last
 *                           successful test, which is a date no calendar can
 *                           know in advance and no cron can express.
 *
 * Everything here is pure calendar arithmetic on PlainDate. No timezones, no
 * instants, no `new Date()` — the caller supplies today, so tests can supply
 * any day they like and the answer never depends on when the suite runs.
 */

export type RecurrenceType =
  | "NONE"
  | "FIXED_INTERVAL"
  | "CYCLICAL_BY_YEAR"
  | "ANCHORED_TO_COMPLETION";

export interface RecurrenceSpec {
  readonly recurrenceType: RecurrenceType;
  readonly intervalMonths?: number | null;
  readonly cycleYears?: number | null;
  /** A year known to be in the cycle. Anchors the whole series. */
  readonly cycleAnchorYear?: number | null;
  /** Calendar day the filing is due, when the law names one. */
  readonly dueMonth?: number | null;
  readonly dueDay?: number | null;
  readonly anchorOffsetMonths?: number | null;
}

export interface RecurrenceInput {
  /** The day to compute from — normally today, in the building's timezone. */
  readonly from: PlainDate;
  /** When this obligation was last completed, if it ever was. */
  readonly lastCompletedOn?: PlainDate | null;
  /** The due date of the occurrence being replaced, for interval chaining. */
  readonly previousDueOn?: PlainDate | null;
}

export type RecurrenceResult =
  | { readonly kind: "due"; readonly dueOn: PlainDate }
  /**
   * The obligation is real but its date cannot be computed yet — nobody has
   * recorded the last passing inspection, or the city's sub-cycle for this
   * building is unknown. Surfaced to the board as a question, never guessed:
   * an invented deadline in a compliance product is worse than an absent one.
   */
  | { readonly kind: "indeterminate"; readonly reason: string }
  /** A one-off that has been completed. Nothing further is owed. */
  | { readonly kind: "complete" };

/** The next occurrence of a month/day on or after `from`. */
function nextAnniversary(from: PlainDate, month: number, day: number): PlainDate {
  const thisYear = clampedDate(yearOf(from), month, day);
  return compareDates(thisYear, from) >= 0
    ? thisYear
    : clampedDate(yearOf(from) + 1, month, day);
}

/** 29 February in a common year becomes 28 February, never 1 March. */
function clampedDate(year: number, month: number, day: number): PlainDate {
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return makeDate(year, month, Math.min(day, lastDay));
}

export function nextDueDate(
  spec: RecurrenceSpec,
  input: RecurrenceInput,
): RecurrenceResult {
  const { from, lastCompletedOn, previousDueOn } = input;

  switch (spec.recurrenceType) {
    case "NONE": {
      if (lastCompletedOn) return { kind: "complete" };
      if (spec.dueMonth && spec.dueDay) {
        return { kind: "due", dueOn: nextAnniversary(from, spec.dueMonth, spec.dueDay) };
      }
      return {
        kind: "indeterminate",
        reason: "This is a one-off with no fixed date. Set the due date by hand.",
      };
    }

    case "FIXED_INTERVAL": {
      // A named calendar date wins: "by 1 September every year" means the first
      // of September, not twelve months after whenever it was last filed.
      if (spec.dueMonth && spec.dueDay) {
        const base = lastCompletedOn && compareDates(lastCompletedOn, from) > 0
          ? lastCompletedOn
          : from;
        return { kind: "due", dueOn: nextAnniversary(base, spec.dueMonth, spec.dueDay) };
      }

      const interval = spec.intervalMonths;
      if (!interval || interval <= 0) {
        return {
          kind: "indeterminate",
          reason: "No interval is recorded for this obligation.",
        };
      }

      // Chain from the previous due date where there is one, so a filing done
      // three weeks late does not permanently shift the building's cycle.
      const anchor = previousDueOn ?? lastCompletedOn ?? from;
      let due = addMonths(anchor, interval);
      while (compareDates(due, from) < 0) due = addMonths(due, interval);
      return { kind: "due", dueOn: due };
    }

    case "ANCHORED_TO_COMPLETION": {
      const offset = spec.anchorOffsetMonths;
      if (!offset || offset <= 0) {
        return {
          kind: "indeterminate",
          reason: "No interval is recorded for this obligation.",
        };
      }
      if (!lastCompletedOn) {
        return {
          kind: "indeterminate",
          reason:
            "This is due a fixed period after the last one passed, and no previous result is on file. Record the date of the last inspection to start the clock.",
        };
      }
      return { kind: "due", dueOn: addMonths(lastCompletedOn, offset) };
    }

    case "CYCLICAL_BY_YEAR": {
      const cycle = spec.cycleYears;
      if (!cycle || cycle <= 0) {
        return {
          kind: "indeterminate",
          reason: "No cycle length is recorded for this obligation.",
        };
      }
      if (!spec.cycleAnchorYear) {
        return {
          kind: "indeterminate",
          reason:
            "The city assigns this building a year in the cycle. Confirm which one, then record it.",
        };
      }

      const month = spec.dueMonth ?? 12;
      const day = spec.dueDay ?? 31;

      let year = spec.cycleAnchorYear;
      const fromYear = yearOf(from);
      // Step forward whole cycles until the resulting date is not in the past.
      while (year < fromYear || compareDates(clampedDate(year, month, day), from) < 0) {
        year += cycle;
      }
      return { kind: "due", dueOn: clampedDate(year, month, day) };
    }
  }
}

/**
 * The next occurrence after completing one. Returns null for obligations that
 * do not repeat, which is the caller's signal to stop generating.
 */
export function occurrenceAfterCompletion(
  spec: RecurrenceSpec,
  completedOn: PlainDate,
  completedDueOn: PlainDate,
): RecurrenceResult {
  if (spec.recurrenceType === "NONE") return { kind: "complete" };

  // The search starts after *the deadline just satisfied*, not after the day
  // the work was done. Filing on 20 August against a 1 September deadline would
  // otherwise regenerate that same 1 September occurrence, and the building
  // would be told it still owes a filing it has already made.
  const dayAfterCompletion = addDay(completedOn);
  const dayAfterDeadline = addDay(completedDueOn);
  const from =
    compareDates(dayAfterDeadline, dayAfterCompletion) > 0
      ? dayAfterDeadline
      : dayAfterCompletion;

  return nextDueDate(spec, {
    from,
    lastCompletedOn: completedOn,
    previousDueOn: completedDueOn,
  });
}

function addDay(date: PlainDate): PlainDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return makeDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

// --- Status ----------------------------------------------------------------

export type DueStatus = "COMPLETED" | "WAIVED" | "NOT_APPLICABLE" | "OVERDUE" | "DUE_SOON" | "UPCOMING";

/** Inside this many days an open obligation reads as needing attention. */
export const DUE_SOON_DAYS = 30;

/**
 * Derived, never stored. A status column goes stale the first day nobody runs
 * the cron, and a compliance calendar that is quietly stale is worse than no
 * calendar at all.
 */
export function dueStatus(
  obligation: {
    readonly state: "OPEN" | "COMPLETED" | "WAIVED" | "NOT_APPLICABLE";
    readonly dueOn: PlainDate;
  },
  today: PlainDate,
): DueStatus {
  if (obligation.state !== "OPEN") return obligation.state;

  const days = daysBetween(today, obligation.dueOn);
  if (days < 0) return "OVERDUE";
  if (days <= DUE_SOON_DAYS) return "DUE_SOON";
  return "UPCOMING";
}

/**
 * The dates reminders should go out, newest offset last. Offsets are days
 * before the due date; any that fall before `notBefore` are dropped, so
 * standing up a building in March does not immediately fire the reminder that
 * was meant for January.
 */
export function reminderDates(
  dueOn: PlainDate,
  offsets: readonly number[],
  notBefore: PlainDate,
): Array<{ offsetDays: number; scheduledFor: PlainDate }> {
  return [...new Set(offsets)]
    .filter((offset) => offset >= 0)
    .sort((a, b) => b - a)
    .map((offsetDays) => ({
      offsetDays,
      scheduledFor: addDaysTo(dueOn, -offsetDays),
    }))
    .filter((r) => compareDates(r.scheduledFor, notBefore) >= 0);
}

function addDaysTo(date: PlainDate, days: number): PlainDate {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return makeDate(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/** Convenience for callers that only need the year, e.g. notice campaigns. */
export function cycleYearFor(spec: RecurrenceSpec, from: PlainDate): number | null {
  const result = nextDueDate(spec, { from });
  return result.kind === "due" ? yearOf(result.dueOn) : null;
}

export { addYears };
