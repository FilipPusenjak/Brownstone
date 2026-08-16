import { assertCan } from "~/lib/auth/capabilities";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";

/**
 * Building work: the roof, the boiler, the parapet.
 *
 * Building-wide by design, like the compliance calendar and unlike arrears.
 * What the building has to spend money on is everybody's business — a
 * shareholder who is about to be assessed four thousand dollars for a roof is
 * entitled to see the estimate, the split, and how their share of it was
 * arrived at, without asking an officer.
 *
 * Work can stand alone (a new boiler) or hang off a compliance obligation (the
 * parapet observation that turns into parapet repairs). That link is the reason
 * this is one concept rather than two: a board looking at "what does this cost
 * us" should not care which of those it started as.
 */

const WORK_SELECT = {
  id: true,
  buildingId: true,
  title: true,
  detail: true,
  status: true,
  estimateCents: true,
  obligationId: true,
  assessmentRaisedAt: true,
  assessmentTotalCents: true,
  assessmentDueOn: true,
  createdAt: true,
  obligation: { select: { id: true, title: true, dueOn: true, state: true } },
  createdBy: { select: { user: { select: { name: true, email: true } } } },
  assessmentRaisedBy: { select: { user: { select: { name: true, email: true } } } },
} as const;

export async function listWork(ctx: BuildingContext) {
  assertCan(ctx, "work.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.buildingWork.findMany({
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
      select: WORK_SELECT,
    }),
  );
}

export async function getWork(ctx: BuildingContext, workId: string) {
  assertCan(ctx, "work.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.buildingWork.findUnique({ where: { id: workId }, select: WORK_SELECT }),
  );
}

/** Work attached to one obligation, for the compliance detail page. */
export async function workForObligation(ctx: BuildingContext, obligationId: string) {
  assertCan(ctx, "work.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.buildingWork.findMany({
      where: { obligationId },
      orderBy: { createdAt: "desc" },
      select: WORK_SELECT,
    }),
  );
}

/**
 * The charges a raised assessment actually produced.
 *
 * Read building-wide rather than through `unitFilter`: this is the assessment
 * for a shared expense, and every shareholder may see what every apartment was
 * charged for it. That is a deliberate exception to the rule that governs the
 * rest of the ledger — arrears are private because falling behind is private,
 * but the split of a roof is a published fact, and a board that could not show
 * it would have a governance problem rather than a privacy one.
 */
export async function assessmentCharges(ctx: BuildingContext, workId: string) {
  assertCan(ctx, "work.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.charge.findMany({
      where: { buildingWorkId: workId },
      orderBy: { amountCents: "desc" },
      select: {
        id: true,
        unitId: true,
        amountCents: true,
        dueOn: true,
        reversesChargeId: true,
        unit: { select: { id: true, label: true } },
      },
    }),
  );
}

/** Unfiltered read used by the tenancy suite. */
export async function listWorkForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.buildingWork.findMany({ select: { id: true, buildingId: true } }),
  );
}
