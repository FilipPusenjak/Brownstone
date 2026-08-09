import type { ScopedTx } from "~/lib/db/tx";
import {
  nextDueDate,
  reminderDates,
  type RecurrenceSpec,
} from "~/lib/primitives/obligations/recurrence";
import { toDbDate, toPlainDate, type PlainDate } from "~/lib/time";
import { asPredicate, evaluate, type BuildingAttributes } from "./applicability";

/**
 * Turning the ruleset into a building's calendar.
 *
 * Two steps, deliberately separate, because the board asked for a review list
 * rather than an auto-generated calendar:
 *
 *   `assessBuilding` evaluates every rule against the building's attributes and
 *   records what it concluded, as a proposal. Nothing reaches the calendar.
 *
 *   `obligationFromRule` runs when a member with `compliance.assess` confirms a
 *   proposal, and creates the tracked obligation and its reminders.
 *
 * The gap between them is the product's honesty. A calendar full of deadlines
 * nobody agreed to is a calendar a board stops trusting the first time one is
 * wrong, and this ruleset ships with thirteen rules whose dates are explicitly
 * unverified.
 */

export interface RuleRow {
  code: string;
  title: string;
  requirement: string;
  applicability: unknown;
  recurrenceType: RecurrenceSpec["recurrenceType"];
  intervalMonths: number | null;
  cycleYears: number | null;
  cycleAnchorYear: number | null;
  dueMonth: number | null;
  dueDay: number | null;
  anchorOffsetMonths: number | null;
  reminderOffsets: number[];
  needsVerification: boolean;
}

export function specOf(rule: RuleRow): RecurrenceSpec {
  return {
    recurrenceType: rule.recurrenceType,
    intervalMonths: rule.intervalMonths,
    cycleYears: rule.cycleYears,
    cycleAnchorYear: rule.cycleAnchorYear,
    dueMonth: rule.dueMonth,
    dueDay: rule.dueDay,
    anchorOffsetMonths: rule.anchorOffsetMonths,
  };
}

export interface AssessmentSummary {
  readonly created: number;
  readonly updated: number;
  readonly changed: string[];
}

/**
 * Re-evaluates every rule for a building and records the verdicts.
 *
 * Idempotent, and safe to run whenever the building's attributes change. A rule
 * the board has already decided keeps its decision — but if the engine's
 * verdict has *flipped* since, that is reported so the board can be told the
 * building changed underneath a decision they made. Silently reversing their
 * call would be worse than either.
 */
export async function assessBuilding(
  tx: ScopedTx,
  buildingId: string,
  attributes: BuildingAttributes,
): Promise<AssessmentSummary> {
  const rules = await tx.complianceRule.findMany({
    select: { code: true, applicability: true },
  });

  const existing = await tx.buildingRuleAssessment.findMany({
    select: { id: true, ruleCode: true, decision: true, engineVerdict: true },
  });
  const byCode = new Map(existing.map((row) => [row.ruleCode, row]));

  let created = 0;
  let updated = 0;
  const changed: string[] = [];

  for (const rule of rules) {
    const verdict = evaluate(asPredicate(rule.applicability), attributes);
    const previous = byCode.get(rule.code);

    if (!previous) {
      await tx.buildingRuleAssessment.create({
        data: {
          buildingId,
          ruleCode: rule.code,
          engineVerdict: verdict.applies,
          engineReason: verdict.reason,
          engineInputs: verdict.inputs as never,
          decision: "PROPOSED",
        },
      });
      created += 1;
      continue;
    }

    if (previous.engineVerdict !== verdict.applies) changed.push(rule.code);

    await tx.buildingRuleAssessment.update({
      where: { id: previous.id },
      data: {
        engineVerdict: verdict.applies,
        engineReason: verdict.reason,
        engineInputs: verdict.inputs as never,
        // A decided rule keeps its decision. Reversing a board's call because
        // an attribute was edited would rewrite the record without anyone
        // knowing; `changed` surfaces it instead.
        ...(previous.decision === "PROPOSED" ? {} : {}),
      },
    });
    updated += 1;
  }

  return { created, updated, changed };
}

export type ObligationDraft =
  | {
      readonly kind: "ready";
      readonly dueOn: PlainDate;
      readonly reminders: Array<{ offsetDays: number; scheduledFor: PlainDate }>;
    }
  | { readonly kind: "needsDate"; readonly reason: string };

/**
 * Works out when a confirmed rule first falls due.
 *
 * Returns `needsDate` rather than guessing when the date cannot be derived —
 * an elevator Category 5 test with no recorded history, or a cyclical rule
 * whose city-assigned year is unknown. The UI then asks. An invented deadline
 * in a compliance product is worse than an absent one, because an absent one
 * gets researched and an invented one gets trusted.
 */
export function draftObligation(
  rule: RuleRow,
  options: { today: PlainDate; lastCompletedOn?: PlainDate | null },
): ObligationDraft {
  const result = nextDueDate(specOf(rule), {
    from: options.today,
    lastCompletedOn: options.lastCompletedOn ?? null,
  });

  if (result.kind === "indeterminate") {
    return { kind: "needsDate", reason: result.reason };
  }
  if (result.kind === "complete") {
    return { kind: "needsDate", reason: "This is a one-off. Set the date it is due." };
  }

  return {
    kind: "ready",
    dueOn: result.dueOn,
    reminders: reminderDates(result.dueOn, rule.reminderOffsets, options.today),
  };
}

/**
 * Creates the obligation and its reminder rows.
 *
 * Reminders are written up front, one per (obligation, offset, date). That
 * triple is unique in the database, so the daily job cannot double-send even if
 * it is invoked twice.
 */
export async function createObligation(
  tx: ScopedTx,
  input: {
    buildingId: string;
    rule: RuleRow;
    assessmentId: string | null;
    dueOn: PlainDate;
    reminders: Array<{ offsetDays: number; scheduledFor: PlainDate }>;
    assigneeId?: string | null;
    parentObligationId?: string | null;
  },
): Promise<{ id: string }> {
  const { rule } = input;

  const obligation = await tx.obligation.create({
    data: {
      buildingId: input.buildingId,
      kind: rule.code.includes("notice") ? "NOTICE" : "COMPLIANCE",
      title: rule.title,
      detail: rule.requirement,
      assessmentId: input.assessmentId,
      ruleCode: rule.code,
      dueOn: toDbDate(input.dueOn),
      recurrenceType: rule.recurrenceType,
      intervalMonths: rule.intervalMonths,
      cycleYears: rule.cycleYears,
      cycleAnchorYear: rule.cycleAnchorYear,
      dueMonth: rule.dueMonth,
      dueDay: rule.dueDay,
      anchorOffsetMonths: rule.anchorOffsetMonths,
      reminderOffsets: rule.reminderOffsets,
      needsVerification: rule.needsVerification,
      assigneeId: input.assigneeId ?? null,
      parentObligationId: input.parentObligationId ?? null,
      state: "OPEN",
    },
    select: { id: true },
  });

  for (const reminder of input.reminders) {
    await tx.obligationReminder.create({
      data: {
        buildingId: input.buildingId,
        obligationId: obligation.id,
        offsetDays: reminder.offsetDays,
        scheduledFor: toDbDate(reminder.scheduledFor),
      },
    });
  }

  return obligation;
}

/** Reads a `@db.Date` column back as a calendar date. */
export function dateOf(value: Date | null): PlainDate | null {
  return value ? toPlainDate(value) : null;
}
