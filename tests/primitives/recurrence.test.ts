import { describe, expect, it } from "vitest";
import {
  DUE_SOON_DAYS,
  dueStatus,
  nextDueDate,
  occurrenceAfterCompletion,
  reminderDates,
  type RecurrenceSpec,
} from "~/lib/primitives/obligations/recurrence";
import { addDays, plainDate, type PlainDate } from "~/lib/time";

const d = (value: string): PlainDate => plainDate(value);

describe("nextDueDate", () => {
  describe("fixed interval pinned to a calendar date", () => {
    const hpdRegistration: RecurrenceSpec = {
      recurrenceType: "FIXED_INTERVAL",
      intervalMonths: 12,
      dueMonth: 9,
      dueDay: 1,
    };

    it("finds this year's date when it is still ahead", () => {
      const result = nextDueDate(hpdRegistration, { from: d("2026-03-15") });
      expect(result).toEqual({ kind: "due", dueOn: d("2026-09-01") });
    });

    it("rolls to next year once the date has passed", () => {
      const result = nextDueDate(hpdRegistration, { from: d("2026-09-02") });
      expect(result).toEqual({ kind: "due", dueOn: d("2027-09-01") });
    });

    it("is due today on the day itself, not next year", () => {
      const result = nextDueDate(hpdRegistration, { from: d("2026-09-01") });
      expect(result).toEqual({ kind: "due", dueOn: d("2026-09-01") });
    });

    it("keeps the calendar date when a filing was late", () => {
      // Filed three weeks late in 2025. The next one is still 1 September —
      // a late filing must not permanently shift the building's cycle.
      const result = nextDueDate(hpdRegistration, {
        from: d("2025-09-22"),
        lastCompletedOn: d("2025-09-22"),
        previousDueOn: d("2025-09-01"),
      });
      expect(result).toEqual({ kind: "due", dueOn: d("2026-09-01") });
    });
  });

  describe("fixed interval with no calendar date", () => {
    const spec: RecurrenceSpec = { recurrenceType: "FIXED_INTERVAL", intervalMonths: 12 };

    it("counts from the previous due date, not the completion date", () => {
      const result = nextDueDate(spec, {
        from: d("2026-04-01"),
        lastCompletedOn: d("2026-03-20"),
        previousDueOn: d("2026-01-15"),
      });
      expect(result).toEqual({ kind: "due", dueOn: d("2027-01-15") });
    });

    it("skips forward past dates that have already gone by", () => {
      const result = nextDueDate(spec, {
        from: d("2030-06-01"),
        previousDueOn: d("2020-01-15"),
      });
      expect(result).toEqual({ kind: "due", dueOn: d("2031-01-15") });
    });

    it("reports indeterminate when no interval is recorded", () => {
      const result = nextDueDate({ recurrenceType: "FIXED_INTERVAL" }, { from: d("2026-01-01") });
      expect(result.kind).toEqual("indeterminate");
    });
  });

  describe("anchored to the last passing result", () => {
    // The elevator Category 5 test: due five years after the last one passed,
    // which no calendar and no cron expression can know in advance.
    const cat5: RecurrenceSpec = {
      recurrenceType: "ANCHORED_TO_COMPLETION",
      anchorOffsetMonths: 60,
    };

    it("counts from the last completion", () => {
      const result = nextDueDate(cat5, {
        from: d("2026-01-01"),
        lastCompletedOn: d("2023-06-12"),
      });
      expect(result).toEqual({ kind: "due", dueOn: d("2028-06-12") });
    });

    it("asks rather than guesses when no previous result is on file", () => {
      const result = nextDueDate(cat5, { from: d("2026-01-01") });
      expect(result.kind).toEqual("indeterminate");
      if (result.kind === "indeterminate") {
        expect(result.reason).toMatch(/last inspection/i);
      }
    });

    it("returns a date in the past when one is overdue", () => {
      // An obligation five years overdue must surface as overdue, not silently
      // roll forward to a comfortable future date.
      const result = nextDueDate(cat5, {
        from: d("2026-01-01"),
        lastCompletedOn: d("2015-06-12"),
      });
      expect(result).toEqual({ kind: "due", dueOn: d("2020-06-12") });
    });
  });

  describe("cyclical by year", () => {
    const fisp: RecurrenceSpec = {
      recurrenceType: "CYCLICAL_BY_YEAR",
      cycleYears: 5,
      cycleAnchorYear: 2020,
      dueMonth: 2,
      dueDay: 21,
    };

    it("steps whole cycles forward from the anchor", () => {
      expect(nextDueDate(fisp, { from: d("2026-01-01") })).toEqual({
        kind: "due",
        dueOn: d("2030-02-21"),
      });
    });

    it("returns the anchor year itself when it is still ahead", () => {
      expect(nextDueDate(fisp, { from: d("2020-01-05") })).toEqual({
        kind: "due",
        dueOn: d("2020-02-21"),
      });
    });

    it("will not invent a cycle the city has not assigned", () => {
      const result = nextDueDate(
        { recurrenceType: "CYCLICAL_BY_YEAR", cycleYears: 4 },
        { from: d("2026-01-01") },
      );
      expect(result.kind).toEqual("indeterminate");
      if (result.kind === "indeterminate") {
        expect(result.reason).toMatch(/city assigns/i);
      }
    });
  });

  describe("one-off", () => {
    it("is complete once done", () => {
      expect(
        nextDueDate(
          { recurrenceType: "NONE" },
          { from: d("2026-01-01"), lastCompletedOn: d("2025-12-01") },
        ),
      ).toEqual({ kind: "complete" });
    });

    it("asks for a date when it has none", () => {
      expect(nextDueDate({ recurrenceType: "NONE" }, { from: d("2026-01-01") }).kind).toEqual(
        "indeterminate",
      );
    });
  });

  describe("calendar edges", () => {
    it("clamps 29 February to the 28th in a common year", () => {
      const leapDay: RecurrenceSpec = {
        recurrenceType: "FIXED_INTERVAL",
        intervalMonths: 12,
        dueMonth: 2,
        dueDay: 29,
      };
      expect(nextDueDate(leapDay, { from: d("2027-01-01") })).toEqual({
        kind: "due",
        dueOn: d("2027-02-28"),
      });
      expect(nextDueDate(leapDay, { from: d("2028-01-01") })).toEqual({
        kind: "due",
        dueOn: d("2028-02-29"),
      });
    });

    it("does not roll 31 January into March when adding a month", () => {
      const monthly: RecurrenceSpec = { recurrenceType: "FIXED_INTERVAL", intervalMonths: 1 };
      const result = nextDueDate(monthly, {
        from: d("2026-02-01"),
        previousDueOn: d("2026-01-31"),
      });
      expect(result).toEqual({ kind: "due", dueOn: d("2026-02-28") });
    });

    it("crosses a year boundary correctly", () => {
      const spec: RecurrenceSpec = {
        recurrenceType: "FIXED_INTERVAL",
        intervalMonths: 12,
        dueMonth: 1,
        dueDay: 15,
      };
      expect(nextDueDate(spec, { from: d("2026-12-31") })).toEqual({
        kind: "due",
        dueOn: d("2027-01-15"),
      });
    });
  });
});

describe("occurrenceAfterCompletion", () => {
  it("generates the next occurrence for a recurring obligation", () => {
    const result = occurrenceAfterCompletion(
      { recurrenceType: "FIXED_INTERVAL", intervalMonths: 12, dueMonth: 9, dueDay: 1 },
      d("2026-08-20"),
      d("2026-09-01"),
    );
    expect(result).toEqual({ kind: "due", dueOn: d("2027-09-01") });
  });

  it("does not regenerate the occurrence just completed early", () => {
    // Filed on 20 August against a 1 September deadline. The next one is 2027,
    // not the 1 September that is still two weeks away.
    const result = occurrenceAfterCompletion(
      { recurrenceType: "FIXED_INTERVAL", intervalMonths: 12, dueMonth: 9, dueDay: 1 },
      d("2026-08-20"),
      d("2026-09-01"),
    );
    if (result.kind !== "due") throw new Error("expected a date");
    expect(result.dueOn > d("2026-09-01")).toBe(true);
  });

  it("stops after a one-off", () => {
    expect(
      occurrenceAfterCompletion({ recurrenceType: "NONE" }, d("2026-01-01"), d("2026-01-01")),
    ).toEqual({ kind: "complete" });
  });

  it("anchors the next Category 5 test to the test that just passed", () => {
    const result = occurrenceAfterCompletion(
      { recurrenceType: "ANCHORED_TO_COMPLETION", anchorOffsetMonths: 60 },
      d("2026-05-04"),
      d("2026-01-01"),
    );
    expect(result).toEqual({ kind: "due", dueOn: d("2031-05-04") });
  });
});

describe("dueStatus", () => {
  const today = d("2026-06-15");

  it("is overdue the day after the deadline", () => {
    expect(dueStatus({ state: "OPEN", dueOn: d("2026-06-14") }, today)).toEqual("OVERDUE");
  });

  it("is not overdue on the day itself", () => {
    expect(dueStatus({ state: "OPEN", dueOn: today }, today)).toEqual("DUE_SOON");
  });

  it("is due soon inside the window and upcoming beyond it", () => {
    const inside = addDays(today, DUE_SOON_DAYS);
    const outside = addDays(today, DUE_SOON_DAYS + 1);
    expect(dueStatus({ state: "OPEN", dueOn: inside }, today)).toEqual("DUE_SOON");
    expect(dueStatus({ state: "OPEN", dueOn: outside }, today)).toEqual("UPCOMING");
  });

  it("never calls a settled obligation overdue", () => {
    const longPast = d("2020-01-01");
    expect(dueStatus({ state: "COMPLETED", dueOn: longPast }, today)).toEqual("COMPLETED");
    expect(dueStatus({ state: "WAIVED", dueOn: longPast }, today)).toEqual("WAIVED");
    expect(dueStatus({ state: "NOT_APPLICABLE", dueOn: longPast }, today)).toEqual(
      "NOT_APPLICABLE",
    );
  });
});

describe("reminderDates", () => {
  it("schedules one date per offset, furthest out first", () => {
    const dates = reminderDates(d("2026-09-01"), [30, 7, 1], d("2026-01-01"));
    expect(dates).toEqual([
      { offsetDays: 30, scheduledFor: d("2026-08-02") },
      { offsetDays: 7, scheduledFor: d("2026-08-25") },
      { offsetDays: 1, scheduledFor: d("2026-08-31") },
    ]);
  });

  it("drops offsets that already passed", () => {
    // Standing a building up in August must not immediately fire the reminder
    // that was meant for June.
    const dates = reminderDates(d("2026-09-01"), [90, 30, 7], d("2026-08-15"));
    expect(dates.map((r) => r.offsetDays)).toEqual([7]);
  });

  it("deduplicates repeated offsets", () => {
    const dates = reminderDates(d("2026-09-01"), [7, 7, 7], d("2026-01-01"));
    expect(dates).toHaveLength(1);
  });

  it("ignores negative offsets", () => {
    const dates = reminderDates(d("2026-09-01"), [-5, 7], d("2026-01-01"));
    expect(dates.map((r) => r.offsetDays)).toEqual([7]);
  });
});
