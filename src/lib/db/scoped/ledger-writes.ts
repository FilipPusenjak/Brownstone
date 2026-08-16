import type { ChargeKind, PaymentMethod } from "~/generated/prisma/enums";
import { assertCan } from "~/lib/auth/capabilities";
import { allocateByShares } from "~/lib/primitives/shares";
import { fail, ok, type Failure, type Result } from "~/lib/result";
import { toDbDate, toPlainDate, type PlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { recordAudit } from "./audit";

/**
 * Writing to the ledger.
 *
 * There is no update and no delete here, and there never should be. A mistake
 * is corrected by a reversing entry that points at what it reverses, so the
 * original stays legible and the correction is itself a dated, attributed fact.
 * That is not a stylistic preference: the runtime database role holds no UPDATE
 * or DELETE on `Charge` or `Payment`, so an attempt to edit history fails at
 * the database even if someone writes the code.
 *
 * Money never moves through this product. `recordPayment` means "a cheque
 * arrived", not "take their money". Co-operator has no payment processor by
 * design and the schema has nowhere to put a card number.
 *
 * Posting is the treasurer's alone — `arrears.postCharge` and
 * `arrears.recordPayment` are not in the president's set. In a twelve-unit
 * building the treasurer is one person, and the point of the separation is that
 * charging a neighbour money takes the specific person whose job that is.
 */

const MAX_CENTS = 100_000_000; // $1,000,000 — a typo guard, not a policy.

/** Returns a failure to hand straight back, or null when the amount is usable. */
function checkAmount(cents: number, field: string): Failure | null {
  if (!Number.isInteger(cents)) {
    return fail("invalid", "Amounts are recorded in whole cents.", {
      [field]: "Enter an amount like 1,250.00",
    });
  }
  if (cents <= 0) {
    return fail("invalid", "An amount has to be more than nothing.", {
      [field]: "Enter an amount greater than zero.",
    });
  }
  if (cents > MAX_CENTS) {
    return fail("invalid", "That amount looks like a typo.", {
      [field]: "Amounts over $1,000,000 have to be entered as separate charges.",
    });
  }
  return null;
}

/** Confirms a unit is in this building. RLS means one from elsewhere is simply absent. */
async function unitInBuilding(
  tx: Parameters<Parameters<typeof withBuildingTx>[1]>[0],
  unitId: string,
): Promise<{ id: string; label: string } | null> {
  return tx.unit.findUnique({
    where: { id: unitId },
    select: { id: true, label: true },
  });
}

export interface PostChargeInput {
  readonly unitId: string;
  readonly kind: ChargeKind;
  readonly amountCents: number;
  readonly dueOn: PlainDate;
  readonly memo?: string | null;
}

export async function postCharge(
  ctx: BuildingContext,
  input: PostChargeInput,
): Promise<Result<{ chargeId: string }>> {
  assertCan(ctx, "arrears.postCharge");

  const bad = checkAmount(input.amountCents, "amountCents");
  if (bad) return bad;

  return withBuildingTx(ctx.building.id, async (tx) => {
    const unit = await unitInBuilding(tx, input.unitId);
    if (!unit) return fail("not_found", "That apartment could not be found.");

    const charge = await tx.charge.create({
      data: {
        buildingId: ctx.building.id,
        unitId: unit.id,
        kind: input.kind,
        amountCents: input.amountCents,
        dueOn: toDbDate(input.dueOn),
        postedOn: toDbDate(input.dueOn),
        memo: input.memo?.trim() || null,
        createdById: ctx.membership.id,
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "arrears.postCharge",
      entityType: "CHARGE",
      entityId: charge.id,
      after: {
        unit: unit.label,
        kind: input.kind,
        amountCents: input.amountCents,
        dueOn: input.dueOn,
      },
      summary: `${describeKind(input.kind)} posted to ${unit.label}`,
    });

    return ok({ chargeId: charge.id });
  });
}

export interface RecordPaymentInput {
  readonly unitId: string;
  readonly amountCents: number;
  readonly receivedOn: PlainDate;
  readonly method: PaymentMethod;
  readonly reference?: string | null;
  readonly memo?: string | null;
}

export async function recordPayment(
  ctx: BuildingContext,
  input: RecordPaymentInput,
): Promise<Result<{ paymentId: string }>> {
  assertCan(ctx, "arrears.recordPayment");

  const bad = checkAmount(input.amountCents, "amountCents");
  if (bad) return bad;

  return withBuildingTx(ctx.building.id, async (tx) => {
    const unit = await unitInBuilding(tx, input.unitId);
    if (!unit) return fail("not_found", "That apartment could not be found.");

    const payment = await tx.payment.create({
      data: {
        buildingId: ctx.building.id,
        unitId: unit.id,
        amountCents: input.amountCents,
        receivedOn: toDbDate(input.receivedOn),
        method: input.method,
        reference: input.reference?.trim() || null,
        memo: input.memo?.trim() || null,
        recordedById: ctx.membership.id,
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "arrears.recordPayment",
      entityType: "PAYMENT",
      entityId: payment.id,
      after: {
        unit: unit.label,
        amountCents: input.amountCents,
        receivedOn: input.receivedOn,
        method: input.method,
      },
      summary: `Payment recorded against ${unit.label}`,
    });

    return ok({ paymentId: payment.id });
  });
}

/**
 * Reverses a charge.
 *
 * The reversal is a second charge for the negative amount carrying the original
 * due date, so the aging arithmetic nets the pair to nothing in the bucket the
 * original sat in rather than crediting today. `liveCharges` in the ledger
 * primitive drops both sides of a reversed pair.
 */
export async function reverseCharge(
  ctx: BuildingContext,
  chargeId: string,
  reason: string,
): Promise<Result<{ chargeId: string }>> {
  assertCan(ctx, "arrears.postCharge");

  const note = reason.trim();
  if (note.length < 3) {
    return fail("invalid", "Say why this is being reversed.", {
      reason: "A future board will read this. A sentence is enough.",
    });
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const original = await tx.charge.findUnique({
      where: { id: chargeId },
      select: {
        id: true,
        unitId: true,
        kind: true,
        amountCents: true,
        dueOn: true,
        reversesChargeId: true,
        unit: { select: { label: true } },
      },
    });
    if (!original) return fail("not_found", "That charge could not be found.");

    if (original.reversesChargeId) {
      return fail("conflict", "That entry is itself a reversal.");
    }

    const existing = await tx.charge.findFirst({
      where: { reversesChargeId: original.id },
      select: { id: true },
    });
    if (existing) return fail("conflict", "That charge has already been reversed.");

    const reversal = await tx.charge.create({
      data: {
        buildingId: ctx.building.id,
        unitId: original.unitId,
        kind: original.kind,
        amountCents: -original.amountCents,
        dueOn: original.dueOn,
        postedOn: toDbDate(toPlainDate(new Date())),
        memo: note,
        reversesChargeId: original.id,
        createdById: ctx.membership.id,
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "arrears.reverseCharge",
      entityType: "CHARGE",
      entityId: reversal.id,
      before: { amountCents: original.amountCents, kind: original.kind },
      after: { reverses: original.id, reason: note },
      summary: `${describeKind(original.kind)} on ${original.unit.label} reversed — ${note}`,
    });

    return ok({ chargeId: reversal.id });
  });
}

/** Reverses a recorded payment — a cheque that bounced, or one keyed twice. */
export async function reversePayment(
  ctx: BuildingContext,
  paymentId: string,
  reason: string,
): Promise<Result<{ paymentId: string }>> {
  assertCan(ctx, "arrears.recordPayment");

  const note = reason.trim();
  if (note.length < 3) {
    return fail("invalid", "Say why this is being reversed.", {
      reason: "“Cheque returned unpaid” is enough.",
    });
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const original = await tx.payment.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        unitId: true,
        amountCents: true,
        receivedOn: true,
        method: true,
        reversesPaymentId: true,
        unit: { select: { label: true } },
      },
    });
    if (!original) return fail("not_found", "That payment could not be found.");

    if (original.reversesPaymentId) {
      return fail("conflict", "That entry is itself a reversal.");
    }

    const existing = await tx.payment.findFirst({
      where: { reversesPaymentId: original.id },
      select: { id: true },
    });
    if (existing) return fail("conflict", "That payment has already been reversed.");

    const reversal = await tx.payment.create({
      data: {
        buildingId: ctx.building.id,
        unitId: original.unitId,
        amountCents: -original.amountCents,
        receivedOn: original.receivedOn,
        method: original.method,
        memo: note,
        reversesPaymentId: original.id,
        recordedById: ctx.membership.id,
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "arrears.reversePayment",
      entityType: "PAYMENT",
      entityId: reversal.id,
      before: { amountCents: original.amountCents },
      after: { reverses: original.id, reason: note },
      summary: `Payment on ${original.unit.label} reversed — ${note}`,
    });

    return ok({ paymentId: reversal.id });
  });
}

export interface ShareWeightedLine {
  readonly unitId: string;
  readonly unitLabel: string;
  readonly shares: number;
  readonly amountCents: number;
}

/**
 * Splits a total across the apartments by share allocation and writes a charge
 * for each, inside a transaction the caller already opened.
 *
 * Shared by the two things that raise money from the whole building — the
 * monthly maintenance run and a special assessment for a piece of work. The
 * delicate part is the same for both and belongs in one place: shares are read
 * *as of the due date* rather than today, because a transfer last month changes
 * who owes what this month, and `allocateByShares` puts the rounding remainder
 * on the largest holders so the parts sum to exactly the total. A building that
 * quietly over- or under-collects by a few cents a month is a reconciliation
 * problem nobody enjoys finding a year later.
 */
async function postShareWeighted(
  tx: Parameters<Parameters<typeof withBuildingTx>[1]>[0],
  ctx: BuildingContext,
  input: {
    kind: ChargeKind;
    dueOn: PlainDate;
    totalCents: number;
    memo: string;
    buildingWorkId?: string;
  },
): Promise<Result<ShareWeightedLine[]>> {
  const due = toDbDate(input.dueOn);

  const units = await tx.unit.findMany({
    orderBy: [{ floorIndex: "asc" }, { label: "asc" }],
    select: {
      id: true,
      label: true,
      shareAllocations: {
        where: {
          effectiveFrom: { lte: due },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: due } }],
        },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
        select: { shares: true },
      },
    },
  });

  const holdings = units
    .map((unit) => ({
      unitId: unit.id,
      label: unit.label,
      shares: unit.shareAllocations[0]?.shares ?? 0,
    }))
    .filter((holding) => holding.shares > 0);

  if (holdings.length === 0) {
    return fail(
      "invalid",
      "No apartment has a share allocation on that date, so there is nothing to split this across.",
    );
  }

  const split = allocateByShares(
    input.totalCents,
    holdings.map((h) => ({ unitId: h.unitId, shares: h.shares })),
  );

  const lines: ShareWeightedLine[] = [];

  for (const holding of holdings) {
    const amountCents = split.get(holding.unitId) ?? 0;
    if (amountCents <= 0) continue;

    await tx.charge.create({
      data: {
        buildingId: ctx.building.id,
        unitId: holding.unitId,
        kind: input.kind,
        amountCents,
        dueOn: due,
        postedOn: due,
        memo: input.memo,
        createdById: ctx.membership.id,
        ...(input.buildingWorkId ? { buildingWorkId: input.buildingWorkId } : {}),
      },
    });

    lines.push({
      unitId: holding.unitId,
      unitLabel: holding.label,
      shares: holding.shares,
      amountCents,
    });
  }

  return ok(lines);
}

export { postShareWeighted };

export interface MaintenanceRunInput {
  /** The month being charged for, as the date the charge falls due. */
  readonly dueOn: PlainDate;
  /** What the building needs to collect that month, in cents. */
  readonly totalCents: number;
  readonly memo?: string | null;
}

export interface MaintenanceRunResult {
  readonly charged: number;
  readonly totalCents: number;
  readonly lines: ReadonlyArray<{ unitLabel: string; amountCents: number }>;
}

/**
 * The monthly maintenance run.
 *
 * Maintenance in a co-op is share-weighted, not per-apartment, so this takes
 * what the building needs to collect and splits it by each unit's share
 * allocation *as of the due date* — a transfer last month changes who owes what
 * this month, and the dated share register is what makes that answerable.
 *
 * `allocateByShares` guarantees the parts sum to exactly the total: the
 * remainder from integer division goes to the largest holders a cent at a time,
 * so the building neither over- nor under-collects by rounding. A treasurer
 * reconciling against the bank account would notice either.
 *
 * Refuses if maintenance has already been posted for that month. Double-posting
 * a building's maintenance is the kind of mistake that generates twelve angry
 * emails and takes an evening to unpick, and a double-submitted form should not
 * be able to cause it.
 */
export async function postMonthlyMaintenance(
  ctx: BuildingContext,
  input: MaintenanceRunInput,
): Promise<Result<MaintenanceRunResult>> {
  assertCan(ctx, "arrears.postCharge");

  const bad = checkAmount(input.totalCents, "totalCents");
  if (bad) return bad;

  const due = toDbDate(input.dueOn);
  const monthStart = input.dueOn.slice(0, 7);

  return withBuildingTx(ctx.building.id, async (tx) => {
    const already = await tx.charge.findFirst({
      where: { kind: "MAINTENANCE", dueOn: due, reversesChargeId: null },
      select: { id: true },
    });
    if (already) {
      return fail(
        "conflict",
        `Maintenance has already been posted for ${monthStart}. Reverse those charges first if they were wrong.`,
      );
    }

    const posted = await postShareWeighted(tx, ctx, {
      kind: "MAINTENANCE",
      dueOn: input.dueOn,
      totalCents: input.totalCents,
      memo: input.memo?.trim() || "Monthly maintenance",
    });
    if (!posted.ok) return posted;
    const lines = posted.data;

    await recordAudit(tx, ctx, {
      action: "arrears.postMonthlyMaintenance",
      entityType: "BUILDING",
      entityId: ctx.building.id,
      after: {
        dueOn: input.dueOn,
        totalCents: input.totalCents,
        units: lines.length,
      },
      summary: `Maintenance posted to ${lines.length} apartments for ${monthStart}`,
    });

    return ok({
      charged: lines.length,
      totalCents: input.totalCents,
      lines,
    });
  });
}

function describeKind(kind: ChargeKind): string {
  const names: Record<ChargeKind, string> = {
    MAINTENANCE: "Maintenance",
    ASSESSMENT: "Assessment",
    LATE_FEE: "Late fee",
    SUBLET_FEE: "Sublet fee",
    DEPOSIT: "Deposit",
    MOVE_FEE: "Move fee",
    LEGAL_FEE: "Legal fee",
    OTHER: "Charge",
  };
  return names[kind] ?? "Charge";
}

export { describeKind };
