import { assertCan } from "~/lib/auth/capabilities";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { unitFilter } from "../visibility";

/**
 * The ledger: charges and payments against a unit.
 *
 * Two things are deliberately absent from this module, and both should stay
 * absent:
 *
 *   No update, no delete. A correction is a reversing entry pointing at what it
 *   reverses. The runtime database role is not granted UPDATE or DELETE on
 *   either table, so this is enforced below the application as well.
 *
 *   No collection. Payments are *recorded* — a cheque arrived, a transfer
 *   cleared. Co-operator never touches money and has no payment processor by
 *   design.
 *
 * Unit scoping matters more here than anywhere else in the product. Which
 * neighbour is behind on maintenance is the most socially explosive fact the
 * system holds, and `arrears.viewAll` belongs to the treasurer and the
 * president alone.
 */

export async function listCharges(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.charge.findMany({
      where: unitFilter(ctx, "arrears"),
      orderBy: [{ dueOn: "desc" }],
      select: {
        id: true,
        buildingId: true,
        unitId: true,
        kind: true,
        amountCents: true,
        dueOn: true,
        postedOn: true,
        memo: true,
        reversesChargeId: true,
        unit: { select: { id: true, label: true } },
      },
    }),
  );
}

export async function listPayments(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.payment.findMany({
      where: unitFilter(ctx, "arrears"),
      orderBy: [{ receivedOn: "desc" }],
      select: {
        id: true,
        buildingId: true,
        unitId: true,
        amountCents: true,
        receivedOn: true,
        method: true,
        reference: true,
        memo: true,
        reversesPaymentId: true,
        unit: { select: { id: true, label: true } },
      },
    }),
  );
}

/** Every ledger entry for one unit, oldest first — the aging input. */
export async function unitLedger(ctx: BuildingContext, unitId: string) {
  const filter = unitFilter(ctx, "arrears");
  if (filter.unitId && !filter.unitId.in.includes(unitId)) {
    return { charges: [], payments: [] };
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const [charges, payments] = await Promise.all([
      tx.charge.findMany({
        where: { unitId },
        orderBy: { dueOn: "asc" },
        select: {
          id: true,
          unitId: true,
          kind: true,
          amountCents: true,
          dueOn: true,
          postedOn: true,
          memo: true,
          reversesChargeId: true,
        },
      }),
      tx.payment.findMany({
        where: { unitId },
        orderBy: { receivedOn: "asc" },
        select: {
          id: true,
          unitId: true,
          amountCents: true,
          receivedOn: true,
          method: true,
          reference: true,
          memo: true,
          reversesPaymentId: true,
        },
      }),
    ]);

    return { charges, payments };
  });
}

export async function listPaymentPlans(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.paymentPlan.findMany({
      where: unitFilter(ctx, "arrears"),
      select: {
        id: true,
        buildingId: true,
        unitId: true,
        totalCents: true,
        installmentCents: true,
        startsOn: true,
        endsOn: true,
      },
    }),
  );
}

/** Every unit's ledger. Officers only — this is the arrears report. */
export async function buildingLedger(ctx: BuildingContext) {
  assertCan(ctx, "arrears.viewAll");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const [charges, payments] = await Promise.all([
      tx.charge.findMany({
        orderBy: { dueOn: "asc" },
        select: {
          id: true,
          unitId: true,
          kind: true,
          amountCents: true,
          dueOn: true,
          reversesChargeId: true,
        },
      }),
      tx.payment.findMany({
        orderBy: { receivedOn: "asc" },
        select: {
          id: true,
          unitId: true,
          amountCents: true,
          receivedOn: true,
          reversesPaymentId: true,
        },
      }),
    ]);

    return { charges, payments };
  });
}

/** Unfiltered reads used by the tenancy suite. */
export async function listChargesForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.charge.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listPaymentsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.payment.findMany({ select: { id: true, buildingId: true } }),
  );
}
