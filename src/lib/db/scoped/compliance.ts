import { assertCan } from "~/lib/auth/capabilities";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";

/**
 * The compliance calendar.
 *
 * Obligations are building-wide: any active member sees what the building owes
 * the city. That is the whole point of the product — the twelve-unit co-op
 * fails because nobody knows what the work is, and hiding the list from the
 * people who live there would recreate the problem it exists to solve.
 */

export async function listObligations(
  ctx: BuildingContext,
  options: { state?: "OPEN" | "COMPLETED" | "WAIVED" | "NOT_APPLICABLE" } = {},
) {
  assertCan(ctx, "compliance.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.obligation.findMany({
      where: options.state ? { state: options.state } : {},
      orderBy: [{ dueOn: "asc" }, { title: "asc" }],
      select: {
        id: true,
        buildingId: true,
        kind: true,
        title: true,
        detail: true,
        ruleCode: true,
        dueOn: true,
        opensOn: true,
        state: true,
        completedOn: true,
        completionNote: true,
        needsVerification: true,
        recurrenceType: true,
        intervalMonths: true,
        cycleYears: true,
        reminderOffsets: true,
        subjectType: true,
        subjectId: true,
        assignee: {
          select: { id: true, user: { select: { name: true, email: true } } },
        },
        completedBy: {
          select: { id: true, user: { select: { name: true, email: true } } },
        },
      },
    }),
  );
}

export async function getObligation(ctx: BuildingContext, obligationId: string) {
  assertCan(ctx, "compliance.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.obligation.findUnique({
      where: { id: obligationId },
      include: {
        assignee: { select: { id: true, user: { select: { name: true, email: true } } } },
        completedBy: {
          select: { id: true, user: { select: { name: true, email: true } } },
        },
        assessment: true,
        reminders: { orderBy: { scheduledFor: "asc" } },
        parent: { select: { id: true, dueOn: true, completedOn: true } },
        children: { select: { id: true, dueOn: true, state: true } },
      },
    }),
  );
}

/** The board's review queue: what the engine proposes, awaiting confirmation. */
export async function listAssessments(
  ctx: BuildingContext,
  options: { decision?: "PROPOSED" | "CONFIRMED" | "DISMISSED" } = {},
) {
  assertCan(ctx, "compliance.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.buildingRuleAssessment.findMany({
      where: options.decision ? { decision: options.decision } : {},
      orderBy: { createdAt: "asc" },
      include: {
        rule: true,
        decidedBy: {
          select: { id: true, user: { select: { name: true, email: true } } },
        },
        obligations: { select: { id: true, dueOn: true, state: true } },
      },
    }),
  );
}

export async function listReminders(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.obligationReminder.findMany({
      orderBy: { scheduledFor: "asc" },
      select: {
        id: true,
        buildingId: true,
        obligationId: true,
        offsetDays: true,
        scheduledFor: true,
        sentAt: true,
      },
    }),
  );
}

/** Unfiltered read used by the tenancy suite. */
export async function listAssessmentsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.buildingRuleAssessment.findMany({ select: { id: true, buildingId: true } }),
  );
}

// The shared ruleset is not building data — the law is the same for every co-op
// in the city — so its reads live in src/lib/compliance/rules.ts rather than
// here. Everything in this directory takes a BuildingContext; a function that
// does not need one does not belong in it.
