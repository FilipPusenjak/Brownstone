import { assertCan } from "~/lib/auth/capabilities";
import type { PlainDate } from "~/lib/time";
import { today, toDbDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";

/**
 * Units and the share register.
 *
 * Share counts are never read from a column on Unit — there isn't one. They
 * come from dated ShareAllocation rows, so a quorum computed for a 2021 meeting
 * still returns the 2021 numbers after a 2024 transfer.
 */

export interface UnitWithShares {
  readonly id: string;
  readonly label: string;
  readonly floorIndex: number;
  readonly line: string | null;
  readonly unitType: string;
  readonly shares: number;
  readonly holderName: string | null;
}

export async function listUnits(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.unit.findMany({
      orderBy: [{ floorIndex: "asc" }, { label: "asc" }],
      select: {
        id: true,
        buildingId: true,
        label: true,
        floorIndex: true,
        line: true,
        unitType: true,
      },
    }),
  );
}

/**
 * Units with their share allocation and holder as of a date.
 *
 * This is what the building elevation renders: cell width is proportional to
 * shares, so the picture of the building *is* the share register.
 */
export async function listUnitsWithShares(
  ctx: BuildingContext,
  asOf: PlainDate = today(ctx.building.timezone),
): Promise<UnitWithShares[]> {
  const on = toDbDate(asOf);

  return withBuildingTx(ctx.building.id, async (tx) => {
    const units = await tx.unit.findMany({
      orderBy: [{ floorIndex: "asc" }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        floorIndex: true,
        line: true,
        unitType: true,
        shareAllocations: {
          where: {
            effectiveFrom: { lte: on },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
          },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { shares: true },
        },
        holdings: {
          where: {
            effectiveFrom: { lte: on },
            OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
          },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { holderName: true },
        },
      },
    });

    return units.map((unit) => ({
      id: unit.id,
      label: unit.label,
      floorIndex: unit.floorIndex,
      line: unit.line,
      unitType: unit.unitType,
      shares: unit.shareAllocations[0]?.shares ?? 0,
      holderName: unit.holdings[0]?.holderName ?? null,
    }));
  });
}

export async function getUnit(ctx: BuildingContext, unitId: string) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.unit.findUnique({
      where: { id: unitId },
      select: {
        id: true,
        buildingId: true,
        label: true,
        floorIndex: true,
        line: true,
        unitType: true,
      },
    }),
  );
}

export async function listShareAllocations(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.shareAllocation.findMany({
      orderBy: { effectiveFrom: "desc" },
      select: {
        id: true,
        buildingId: true,
        unitId: true,
        shares: true,
        effectiveFrom: true,
        effectiveTo: true,
      },
    }),
  );
}

export async function listUnitHoldings(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.unitHolding.findMany({
      orderBy: { effectiveFrom: "desc" },
      select: {
        id: true,
        buildingId: true,
        unitId: true,
        holderName: true,
        effectiveFrom: true,
        effectiveTo: true,
        certificateNo: true,
      },
    }),
  );
}

export async function listMembers(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.membership.findMany({
      where: { status: "ACTIVE" },
      orderBy: { joinedOn: "asc" },
      select: {
        id: true,
        buildingId: true,
        roles: true,
        status: true,
        title: true,
        user: { select: { id: true, name: true, email: true } },
        units: { select: { unitId: true, relation: true } },
      },
    }),
  );
}

export async function listMembershipUnits(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.membershipUnit.findMany({
      select: { id: true, buildingId: true, membershipId: true, unitId: true },
    }),
  );
}

export async function listInvitations(ctx: BuildingContext) {
  assertCan(ctx, "member.invite");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.invitation.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        buildingId: true,
        email: true,
        roles: true,
        unitIds: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        createdAt: true,
      },
    }),
  );
}

/** Unfiltered read used by the tenancy suite. */
export async function listInvitationsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.invitation.findMany({ select: { id: true, buildingId: true } }),
  );
}
