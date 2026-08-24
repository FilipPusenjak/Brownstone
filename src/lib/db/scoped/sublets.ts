import { can } from "~/lib/auth/capabilities";
import { isRunningOn, readCap, type CapReading } from "~/lib/primitives/sublets";
import { today, toPlainDate, type PlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx, type ScopedTx } from "../tx";
import { unitFilter } from "../visibility";

/**
 * The sublet register.
 *
 * Unit-scoped like arrears and alterations: a shareholder sees their own
 * applications, an officer with `sublet.viewAll` sees the register. The
 * *count*, though, is building-wide and visible to everyone, and that asymmetry
 * is deliberate — how much of the building is sublet affects every shareholder
 * trying to sell, so the number is published even where the names are not.
 *
 * Whether a sublet is running today is derived from its dates and its approval,
 * never stored. A status column would be a second source of truth for a fact
 * the dates already answer, and the day the two disagree is the day somebody is
 * refused a sublet the register says there is room for.
 */

const SUBLET_SELECT = {
  id: true,
  buildingId: true,
  unitId: true,
  subtenantName: true,
  subtenantContact: true,
  termStart: true,
  termEnd: true,
  feeCents: true,
  endedOn: true,
  endedReason: true,
  renewedFromId: true,
  obligationId: true,
  createdAt: true,
  unit: { select: { id: true, label: true } },
  createdBy: { select: { user: { select: { name: true, email: true } } } },
  endedBy: { select: { user: { select: { name: true, email: true } } } },
  approval: {
    select: {
      id: true,
      status: true,
      submittedAt: true,
      submittedById: true,
      decidedAt: true,
      decisionNote: true,
      conditions: true,
      withdrawnAt: true,
      submittedBy: { select: { user: { select: { name: true, email: true } } } },
      decidedBy: { select: { user: { select: { name: true, email: true } } } },
    },
  },
} as const;

type SubletRow = {
  termStart: Date;
  termEnd: Date;
  endedOn: Date | null;
  approval: { status: string } | null;
};

/** Approved, and covering the date. The definition the cap counts against. */
export function isActiveOn(sublet: SubletRow, date: PlainDate): boolean {
  if (!isApproved(sublet)) return false;
  return isRunningOn(
    {
      start: toPlainDate(sublet.termStart),
      end: toPlainDate(sublet.termEnd),
      endedOn: sublet.endedOn ? toPlainDate(sublet.endedOn) : null,
    },
    date,
  );
}

export function isApproved(sublet: { approval: { status: string } | null }): boolean {
  return (
    sublet.approval?.status === "APPROVED" ||
    sublet.approval?.status === "APPROVED_WITH_CONDITIONS"
  );
}

export function isPending(sublet: { approval: { status: string } | null }): boolean {
  return (
    sublet.approval?.status === "SUBMITTED" ||
    sublet.approval?.status === "UNDER_REVIEW" ||
    sublet.approval?.status === "DRAFT"
  );
}

export async function listSublets(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.subletRegistration.findMany({
      where: unitFilter(ctx, "sublet"),
      orderBy: { termEnd: "desc" },
      select: SUBLET_SELECT,
    }),
  );
}

export async function getSublet(ctx: BuildingContext, subletId: string) {
  return withBuildingTx(ctx.building.id, async (tx) => {
    const sublet = await tx.subletRegistration.findUnique({
      where: { id: subletId },
      select: SUBLET_SELECT,
    });
    if (!sublet) return null;

    // Same as a missing record for a neighbour's application. "It exists but is
    // not yours" is itself a disclosure in a building this size.
    if (!can(ctx, "sublet.viewAll") && !ctx.unitIds.includes(sublet.unitId)) {
      return null;
    }

    const [comments, charges, renewals] = await Promise.all([
      sublet.approval
        ? tx.approvalComment.findMany({
            where: {
              requestId: sublet.approval.id,
              ...(can(ctx, "sublet.decide") ? {} : { visibility: "SHARED" }),
            },
            orderBy: { createdAt: "asc" },
            select: {
              id: true,
              body: true,
              visibility: true,
              createdAt: true,
              author: { select: { user: { select: { name: true, email: true } } } },
            },
          })
        : Promise.resolve([]),

      tx.charge.findMany({
        where: { subletId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          amountCents: true,
          dueOn: true,
          memo: true,
          reversesChargeId: true,
        },
      }),

      tx.subletRegistration.findMany({
        where: { renewedFromId: subletId },
        select: { id: true, termStart: true, termEnd: true },
      }),
    ]);

    return { ...sublet, comments, charges, renewals };
  });
}

export type SubletDetail = NonNullable<Awaited<ReturnType<typeof getSublet>>>;

/** Charges against a sublet that have not been reversed. */
export function liveCharges(charges: SubletDetail["charges"]): SubletDetail["charges"] {
  const reversed = new Set(
    charges.map((c) => c.reversesChargeId).filter((id): id is string => Boolean(id)),
  );
  return charges.filter((c) => !c.reversesChargeId && !reversed.has(c.id));
}

/**
 * How much of the building is sublet, against what the lease allows.
 *
 * Counted building-wide, deliberately outside `unitFilter`. A shareholder may
 * not see which of their neighbours has a subtenant, but they are entitled to
 * know whether the corporation is at its cap — it governs whether they may
 * apply themselves, and it is the figure a buyer's lender will ask about.
 */
export async function subletCap(
  ctx: BuildingContext,
  asOf: PlainDate = today(ctx.building.timezone),
): Promise<CapReading> {
  return withBuildingTx(ctx.building.id, (tx) => capWithin(tx, ctx, asOf));
}

/** The same reading, inside a caller's transaction. */
export async function capWithin(
  tx: ScopedTx,
  ctx: BuildingContext,
  asOf: PlainDate,
): Promise<CapReading> {
  const [building, totalUnits, candidates] = await Promise.all([
    tx.building.findUniqueOrThrow({
      where: { id: ctx.building.id },
      select: { subletCapPercent: true },
    }),
    tx.unit.count(),
    tx.subletRegistration.findMany({
      select: {
        termStart: true,
        termEnd: true,
        endedOn: true,
        approval: { select: { status: true } },
      },
    }),
  ]);

  return readCap({
    totalUnits,
    capPercent: building.subletCapPercent,
    current: candidates.filter((sublet) => isActiveOn(sublet, asOf)).length,
  });
}

/** Unfiltered read used by the tenancy suite. */
export async function listSubletsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.subletRegistration.findMany({ select: { id: true, buildingId: true } }),
  );
}
