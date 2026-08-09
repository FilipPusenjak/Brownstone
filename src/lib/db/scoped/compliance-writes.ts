import { assertCan } from "~/lib/auth/capabilities";
import {
  createObligation,
  dateOf,
  draftObligation,
  specOf,
  type RuleRow,
} from "~/lib/compliance/generate";
import { attributesOf } from "~/lib/compliance/applicability";
import { assessBuilding } from "~/lib/compliance/generate";
import { fail, ok, type Result } from "~/lib/result";
import {
  occurrenceAfterCompletion,
  reminderDates,
} from "~/lib/primitives/obligations/recurrence";
import { plainDate, toDbDate, today, type PlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { recordAudit } from "./audit";

/**
 * Compliance mutations.
 *
 * Every one of these runs inside a single `withBuildingTx`, so the change, the
 * obligations it generates and the audit record commit together or not at all.
 * An audit log that can disagree with the data it describes is worse than none,
 * and a calendar that can lose the next occurrence of a filing it just marked
 * complete is exactly the failure this product exists to prevent.
 *
 * They return `Result` rather than throwing, so a Server Action can tell
 * someone what happened in words they can act on.
 */

const RULE_SELECT = {
  code: true,
  title: true,
  requirement: true,
  applicability: true,
  recurrenceType: true,
  intervalMonths: true,
  cycleYears: true,
  cycleAnchorYear: true,
  dueMonth: true,
  dueDay: true,
  anchorOffsetMonths: true,
  reminderOffsets: true,
  needsVerification: true,
} as const;

/** Re-runs the applicability engine over the building's current attributes. */
export async function reassessBuilding(
  ctx: BuildingContext,
): Promise<Result<{ created: number; changed: string[] }>> {
  assertCan(ctx, "compliance.assess");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const building = await tx.building.findUnique({
      where: { id: ctx.building.id },
      select: {
        unitCount: true,
        stories: true,
        yearBuilt: true,
        grossSquareFeet: true,
        hasElevator: true,
        gasService: true,
        oilTankPresent: true,
        sprinklerStatus: true,
        facadeHeightFt: true,
        isLandmarked: true,
        hasParapet: true,
        ownerOccupied: true,
      },
    });
    if (!building) return fail("not_found", "This building could not be loaded.");

    const summary = await assessBuilding(tx, ctx.building.id, attributesOf(building));

    await recordAudit(tx, ctx, {
      action: "compliance.assess",
      entityType: "BUILDING",
      entityId: ctx.building.id,
      after: summary,
      summary: `Reviewed requirements: ${summary.created} new, ${summary.changed.length} changed`,
    });

    return ok({ created: summary.created, changed: summary.changed });
  });
}

/**
 * The board confirms a proposal, and it joins the calendar.
 *
 * `dueOn` is optional: supplied when the rule's date cannot be derived, which
 * the review list asks for up front rather than inventing.
 */
export async function confirmAssessment(
  ctx: BuildingContext,
  input: { ruleCode: string; dueOn?: string | null; note?: string | null },
): Promise<Result<{ obligationId: string }>> {
  assertCan(ctx, "compliance.assess");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const assessment = await tx.buildingRuleAssessment.findUnique({
      where: {
        buildingId_ruleCode: { buildingId: ctx.building.id, ruleCode: input.ruleCode },
      },
      select: { id: true, decision: true, engineVerdict: true },
    });
    if (!assessment) {
      return fail("not_found", "That requirement isn't on this building's list.");
    }
    if (assessment.decision === "CONFIRMED") {
      return fail("conflict", "This requirement is already being tracked.");
    }

    const rule = (await tx.complianceRule.findUnique({
      where: { code: input.ruleCode },
      select: RULE_SELECT,
    })) as RuleRow | null;
    if (!rule) return fail("not_found", "That requirement no longer exists.");

    const now = today(ctx.building.timezone);

    let dueOn: PlainDate;
    let reminders: Array<{ offsetDays: number; scheduledFor: PlainDate }>;

    if (input.dueOn) {
      try {
        dueOn = plainDate(input.dueOn);
      } catch {
        return fail("invalid", "Enter the due date as a calendar date.", {
          dueOn: "Use the date picker, or type it as YYYY-MM-DD.",
        });
      }
      reminders = reminderDates(dueOn, rule.reminderOffsets, now);
    } else {
      const draft = draftObligation(rule, { today: now });
      if (draft.kind === "needsDate") {
        return fail("invalid", draft.reason, { dueOn: "Set the date this is due." });
      }
      dueOn = draft.dueOn;
      reminders = draft.reminders;
    }

    await tx.buildingRuleAssessment.update({
      where: { id: assessment.id },
      data: {
        decision: "CONFIRMED",
        decidedAt: new Date(),
        decidedById: ctx.membership.id,
        decisionNote: input.note ?? null,
      },
    });

    const obligation = await createObligation(tx, {
      buildingId: ctx.building.id,
      rule,
      assessmentId: assessment.id,
      dueOn,
      reminders,
    });

    await recordAudit(tx, ctx, {
      action: "compliance.confirm",
      entityType: "OBLIGATION",
      entityId: obligation.id,
      after: { ruleCode: rule.code, dueOn },
      summary: `${rule.title} added to the calendar, due ${dueOn}`,
    });

    return ok({ obligationId: obligation.id });
  });
}

/**
 * The board decides a rule does not apply.
 *
 * The reason is required and kept forever. When the next board asks why the
 * building isn't tracking gas inspections, the answer needs a name and a date
 * on it — that continuity is the entire reason this product exists.
 */
export async function dismissAssessment(
  ctx: BuildingContext,
  input: { ruleCode: string; note: string },
): Promise<Result<null>> {
  assertCan(ctx, "compliance.assess");

  const note = input.note.trim();
  if (note.length < 10) {
    return fail("invalid", "Say why this doesn't apply.", {
      note: "A future board will read this. A sentence is enough.",
    });
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const assessment = await tx.buildingRuleAssessment.findUnique({
      where: {
        buildingId_ruleCode: { buildingId: ctx.building.id, ruleCode: input.ruleCode },
      },
      select: { id: true, decision: true },
    });
    if (!assessment) {
      return fail("not_found", "That requirement isn't on this building's list.");
    }

    await tx.buildingRuleAssessment.update({
      where: { id: assessment.id },
      data: {
        decision: "DISMISSED",
        decidedAt: new Date(),
        decidedById: ctx.membership.id,
        decisionNote: note,
      },
    });

    await recordAudit(tx, ctx, {
      action: "compliance.dismiss",
      entityType: "BUILDING",
      entityId: ctx.building.id,
      after: { ruleCode: input.ruleCode, note },
      summary: `${input.ruleCode} marked not applicable`,
    });

    return ok(null);
  });
}

/**
 * Marks a filing done and generates the next one.
 *
 * Both happen in one transaction. If the next occurrence could not be created,
 * the completion rolls back too — a recurring obligation that silently stops
 * recurring is the worst outcome available here, because the calendar looks
 * healthy right up until the deadline passes unnoticed.
 */
export async function completeObligation(
  ctx: BuildingContext,
  input: { obligationId: string; completedOn?: string | null; note?: string | null },
): Promise<Result<{ nextObligationId: string | null; nextDueOn: string | null }>> {
  assertCan(ctx, "compliance.markComplete");

  const now = today(ctx.building.timezone);

  let completedOn: PlainDate;
  try {
    completedOn = input.completedOn ? plainDate(input.completedOn) : now;
  } catch {
    return fail("invalid", "Enter the completion date as a calendar date.", {
      completedOn: "Use the date picker, or type it as YYYY-MM-DD.",
    });
  }

  if (completedOn > now) {
    return fail("invalid", "That date is in the future.", {
      completedOn: "Record a filing after it has been made, not before.",
    });
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const obligation = await tx.obligation.findUnique({
      where: { id: input.obligationId },
      select: {
        id: true,
        title: true,
        state: true,
        dueOn: true,
        ruleCode: true,
        assessmentId: true,
        assigneeId: true,
        recurrenceType: true,
        intervalMonths: true,
        cycleYears: true,
        cycleAnchorYear: true,
        dueMonth: true,
        dueDay: true,
        anchorOffsetMonths: true,
        reminderOffsets: true,
      },
    });
    if (!obligation) return fail("not_found", "That obligation could not be found.");
    if (obligation.state !== "OPEN") {
      return fail("conflict", "This one is already closed out.");
    }

    await tx.obligation.update({
      where: { id: obligation.id },
      data: {
        state: "COMPLETED",
        completedOn: toDbDate(completedOn),
        completedById: ctx.membership.id,
        completionNote: input.note ?? null,
      },
    });

    // Any reminder that has not gone out is now moot.
    await tx.obligationReminder.deleteMany({
      where: { obligationId: obligation.id, sentAt: null },
    });

    const dueOn = dateOf(obligation.dueOn);
    let next: { id: string } | null = null;
    let nextDueOn: PlainDate | null = null;

    if (dueOn) {
      const result = occurrenceAfterCompletion(
        {
          recurrenceType: obligation.recurrenceType,
          intervalMonths: obligation.intervalMonths,
          cycleYears: obligation.cycleYears,
          cycleAnchorYear: obligation.cycleAnchorYear,
          dueMonth: obligation.dueMonth,
          dueDay: obligation.dueDay,
          anchorOffsetMonths: obligation.anchorOffsetMonths,
        },
        completedOn,
        dueOn,
      );

      if (result.kind === "due") {
        const rule = obligation.ruleCode
          ? ((await tx.complianceRule.findUnique({
              where: { code: obligation.ruleCode },
              select: RULE_SELECT,
            })) as RuleRow | null)
          : null;

        const carried: RuleRow = rule ?? {
          code: obligation.ruleCode ?? "custom",
          title: obligation.title,
          requirement: "",
          applicability: { always: true },
          recurrenceType: obligation.recurrenceType,
          intervalMonths: obligation.intervalMonths,
          cycleYears: obligation.cycleYears,
          cycleAnchorYear: obligation.cycleAnchorYear,
          dueMonth: obligation.dueMonth,
          dueDay: obligation.dueDay,
          anchorOffsetMonths: obligation.anchorOffsetMonths,
          reminderOffsets: obligation.reminderOffsets,
          needsVerification: false,
        };

        nextDueOn = result.dueOn;
        next = await createObligation(tx, {
          buildingId: ctx.building.id,
          rule: carried,
          assessmentId: obligation.assessmentId,
          dueOn: result.dueOn,
          reminders: reminderDates(result.dueOn, carried.reminderOffsets, completedOn),
          assigneeId: obligation.assigneeId,
          parentObligationId: obligation.id,
        });
      }
    }

    await recordAudit(tx, ctx, {
      action: "compliance.markComplete",
      entityType: "OBLIGATION",
      entityId: obligation.id,
      before: { state: obligation.state },
      after: { state: "COMPLETED", completedOn, nextDueOn },
      summary: `${obligation.title} filed ${completedOn}`,
    });

    return ok({ nextObligationId: next?.id ?? null, nextDueOn });
  });
}

/** Puts a name against a filing. Officers pick, everyone can see who. */
export async function assignObligation(
  ctx: BuildingContext,
  input: { obligationId: string; membershipId: string | null },
): Promise<Result<null>> {
  assertCan(ctx, "compliance.manage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const obligation = await tx.obligation.findUnique({
      where: { id: input.obligationId },
      select: { id: true, title: true, assigneeId: true },
    });
    if (!obligation) return fail("not_found", "That obligation could not be found.");

    if (input.membershipId) {
      // Row-level security already confines this to the building, so a
      // membership id from elsewhere simply will not be found.
      const member = await tx.membership.findUnique({
        where: { id: input.membershipId },
        select: { id: true, status: true },
      });
      if (!member || member.status !== "ACTIVE") {
        return fail("invalid", "That person isn't an active member of this building.");
      }
    }

    await tx.obligation.update({
      where: { id: obligation.id },
      data: { assigneeId: input.membershipId },
    });

    await recordAudit(tx, ctx, {
      action: "compliance.assign",
      entityType: "OBLIGATION",
      entityId: obligation.id,
      before: { assigneeId: obligation.assigneeId },
      after: { assigneeId: input.membershipId },
      summary: `${obligation.title} reassigned`,
    });

    return ok(null);
  });
}

/**
 * Takes an obligation off the calendar without pretending it was filed.
 *
 * Distinct from completion on purpose: "we don't have to do this" and "we did
 * this" are different facts, and conflating them would let a building's record
 * claim a filing that never happened.
 */
export async function waiveObligation(
  ctx: BuildingContext,
  input: { obligationId: string; reason: string; notApplicable?: boolean },
): Promise<Result<null>> {
  assertCan(ctx, "compliance.manage");

  const reason = input.reason.trim();
  if (reason.length < 10) {
    return fail("invalid", "Say why this is coming off the calendar.", {
      reason: "A future board will read this. A sentence is enough.",
    });
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const obligation = await tx.obligation.findUnique({
      where: { id: input.obligationId },
      select: { id: true, title: true, state: true },
    });
    if (!obligation) return fail("not_found", "That obligation could not be found.");
    if (obligation.state !== "OPEN") {
      return fail("conflict", "This one is already closed out.");
    }

    await tx.obligation.update({
      where: { id: obligation.id },
      data: {
        state: input.notApplicable ? "NOT_APPLICABLE" : "WAIVED",
        waivedAt: new Date(),
        waivedReason: reason,
      },
    });

    await tx.obligationReminder.deleteMany({
      where: { obligationId: obligation.id, sentAt: null },
    });

    await recordAudit(tx, ctx, {
      action: "compliance.waive",
      entityType: "OBLIGATION",
      entityId: obligation.id,
      before: { state: obligation.state },
      after: { state: input.notApplicable ? "NOT_APPLICABLE" : "WAIVED", reason },
      summary: `${obligation.title} removed from the calendar`,
    });

    return ok(null);
  });
}

/** Re-opens something closed out by mistake. */
export async function reopenObligation(
  ctx: BuildingContext,
  input: { obligationId: string },
): Promise<Result<null>> {
  assertCan(ctx, "compliance.manage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const obligation = await tx.obligation.findUnique({
      where: { id: input.obligationId },
      select: {
        id: true,
        title: true,
        state: true,
        dueOn: true,
        reminderOffsets: true,
      },
    });
    if (!obligation) return fail("not_found", "That obligation could not be found.");
    if (obligation.state === "OPEN") {
      return fail("conflict", "This one is already open.");
    }

    await tx.obligation.update({
      where: { id: obligation.id },
      data: {
        state: "OPEN",
        completedOn: null,
        completedById: null,
        completionNote: null,
        waivedAt: null,
        waivedReason: null,
      },
    });

    await recordAudit(tx, ctx, {
      action: "compliance.reopen",
      entityType: "OBLIGATION",
      entityId: obligation.id,
      before: { state: obligation.state },
      after: { state: "OPEN" },
      summary: `${obligation.title} reopened`,
    });

    return ok(null);
  });
}

export { specOf };
