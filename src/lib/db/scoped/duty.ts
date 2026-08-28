import { assertCan } from "~/lib/auth/capabilities";
import { turnOn, turnsEach, type Rotation } from "~/lib/primitives/duty";
import { today, toDbDate, toPlainDate, type PlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx, type ScopedTx } from "../tx";

/**
 * The duty rotation, and the sanitation fines it exists to prevent.
 *
 * Building-wide: whose week it is to put the bins out is not private, and a
 * rotation only works if everyone can see it. The fines are building-wide too,
 * for a less comfortable reason — a fine attributed to one apartment is a fact
 * that apartment's neighbours are entitled to check.
 *
 * The recorded assignment is the truth, not the formula. Both exist because a
 * rotation is generated ahead of time from `unitOrder`, `startsOn` and
 * `periodDays`, but a swap moves a turn to a different apartment, and after
 * that the formula is wrong about that week for ever. Every read here prefers
 * the row.
 */

const ROTATION_SELECT = {
  id: true,
  buildingId: true,
  name: true,
  kind: true,
  unitOrder: true,
  startsOn: true,
  periodDays: true,
  active: true,
  createdAt: true,
} as const;

const ASSIGNMENT_SELECT = {
  id: true,
  rotationId: true,
  unitId: true,
  originalUnitId: true,
  periodStart: true,
  periodEnd: true,
  obligationId: true,
  swappedWithId: true,
  swappedAt: true,
  unit: { select: { id: true, label: true } },
  swappedBy: { select: { user: { select: { name: true, email: true } } } },
  obligation: { select: { id: true, state: true, completedOn: true } },
} as const;

const FINE_SELECT = {
  id: true,
  buildingId: true,
  unitId: true,
  ticketNumber: true,
  issuedOn: true,
  violation: true,
  amountCents: true,
  paidOn: true,
  contestedOn: true,
  hearingOn: true,
  outcome: true,
  note: true,
  obligationId: true,
  dutyAssignmentId: true,
  createdAt: true,
  unit: { select: { id: true, label: true } },
  recordedBy: { select: { user: { select: { name: true, email: true } } } },
  dutyAssignment: {
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      unit: { select: { label: true } },
      originalUnitId: true,
    },
  },
} as const;

export async function listRotations(ctx: BuildingContext) {
  assertCan(ctx, "duty.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.dutyRotation.findMany({
      orderBy: [{ active: "desc" }, { createdAt: "asc" }],
      select: {
        ...ROTATION_SELECT,
        _count: { select: { assignments: true } },
      },
    }),
  );
}

export async function getRotation(ctx: BuildingContext, rotationId: string) {
  assertCan(ctx, "duty.view");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const rotation = await tx.dutyRotation.findUnique({
      where: { id: rotationId },
      select: ROTATION_SELECT,
    });
    if (!rotation) return null;

    const assignments = await tx.dutyAssignment.findMany({
      where: { rotationId },
      orderBy: { periodStart: "asc" },
      select: ASSIGNMENT_SELECT,
    });

    return { ...rotation, assignments };
  });
}

export type RotationDetail = NonNullable<Awaited<ReturnType<typeof getRotation>>>;
export type Assignment = RotationDetail["assignments"][number];

/** The shape the primitive wants, out of a stored rotation. */
export function asRotation(rotation: {
  unitOrder: string[];
  startsOn: Date;
  periodDays: number;
}): Rotation {
  return {
    unitOrder: rotation.unitOrder,
    startsOn: toPlainDate(rotation.startsOn),
    periodDays: rotation.periodDays,
  };
}

/**
 * Whose turn it was on a date — the recorded one if there is one.
 *
 * This is the module's whole point. The formula answers for any date; the
 * recorded assignment answers correctly, because it carries swaps. A caller
 * that reaches for the formula when a row exists will name the wrong neighbour
 * on exactly the weeks somebody did their neighbour a favour.
 */
export function turnForDate(
  rotation: { unitOrder: string[]; startsOn: Date; periodDays: number },
  assignments: readonly Assignment[],
  date: PlainDate,
): { unitId: string; assignment: Assignment | null } | null {
  const recorded = assignments.find(
    (row) => toPlainDate(row.periodStart) <= date && date <= toPlainDate(row.periodEnd),
  );
  if (recorded) return { unitId: recorded.unitId, assignment: recorded };

  const computed = turnOn(asRotation(rotation), date);
  if (!computed) return null;
  return { unitId: computed.unitId, assignment: null };
}

/** How many turns each apartment has had, over the assignments on record. */
export function turnsPerUnit(assignments: readonly Assignment[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of assignments) {
    counts.set(row.unitId, (counts.get(row.unitId) ?? 0) + 1);
  }
  return counts;
}

export { turnsEach };

/** Every rotation's current turn, for the module's landing page. */
export async function currentTurns(
  ctx: BuildingContext,
  asOf: PlainDate = today(ctx.building.timezone),
) {
  assertCan(ctx, "duty.view");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const rotations = await tx.dutyRotation.findMany({
      where: { active: true },
      orderBy: { createdAt: "asc" },
      select: ROTATION_SELECT,
    });

    return Promise.all(
      rotations.map(async (rotation) => {
        const assignments = await tx.dutyAssignment.findMany({
          where: { rotationId: rotation.id },
          orderBy: { periodStart: "asc" },
          select: ASSIGNMENT_SELECT,
        });

        const now = turnForDate(rotation, assignments, asOf);
        const upcoming = assignments.filter(
          (row) => toPlainDate(row.periodStart) > asOf,
        );

        return {
          rotation,
          assignments,
          current: now,
          next: upcoming[0] ?? null,
          generatedThrough:
            assignments.length > 0
              ? toPlainDate(assignments[assignments.length - 1]!.periodEnd)
              : null,
        };
      }),
    );
  });
}

export async function listFines(ctx: BuildingContext) {
  assertCan(ctx, "duty.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.dsnyFine.findMany({
      orderBy: { issuedOn: "desc" },
      select: FINE_SELECT,
    }),
  );
}

export async function getFine(ctx: BuildingContext, fineId: string) {
  assertCan(ctx, "duty.view");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const fine = await tx.dsnyFine.findUnique({
      where: { id: fineId },
      select: FINE_SELECT,
    });
    if (!fine) return null;

    const charges = await tx.charge.findMany({
      where: { dsnyFineId: fineId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        unitId: true,
        amountCents: true,
        dueOn: true,
        reversesChargeId: true,
        unit: { select: { label: true } },
      },
    });

    return { ...fine, charges };
  });
}

export type FineDetail = NonNullable<Awaited<ReturnType<typeof getFine>>>;

export function liveCharges(charges: FineDetail["charges"]): FineDetail["charges"] {
  const reversed = new Set(
    charges.map((c) => c.reversesChargeId).filter((id): id is string => Boolean(id)),
  );
  return charges.filter((c) => !c.reversesChargeId && !reversed.has(c.id));
}

export interface CoveringTurn {
  readonly id: string;
  readonly unitId: string;
  readonly rotationId: string;
  readonly rotationName: string;
}

/**
 * Every turn that covers a date — usually one, and the point is the "usually".
 *
 * A building with a bin rota and a recycling rota has two turns running on any
 * given Tuesday, and they are frequently different apartments. Asking for "the"
 * turn on a date is therefore a question with no answer, and the previous
 * version of this function answered it anyway: it took whichever row sorted
 * first by `periodStart` and handed it back as fact. A sanitation summons for
 * a bin violation could be attributed to whoever had the recycling week, and
 * then billed to them.
 *
 * So this returns all of them and lets the caller decide what to do with more
 * than one. `logFine` refuses to guess and asks which rota the summons is
 * about, which is the same answer the module already gives when the rota covers
 * nothing at all: leave it unattributed rather than pin it on somebody
 * plausible.
 *
 * Used by the write path so it and the read path agree about attribution.
 */
export async function turnsCovering(
  tx: ScopedTx,
  date: PlainDate,
): Promise<CoveringTurn[]> {
  // Both bounds in the query rather than a `take` and a filter in memory: the
  // old version read the eight most recent starts and hoped the covering row
  // was among them, which stops being true at four rotations.
  const rows = await tx.dutyAssignment.findMany({
    where: {
      periodStart: { lte: toDbDate(date) },
      periodEnd: { gte: toDbDate(date) },
    },
    orderBy: { periodStart: "desc" },
    select: {
      id: true,
      unitId: true,
      rotationId: true,
      rotation: { select: { name: true } },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    unitId: row.unitId,
    rotationId: row.rotationId,
    rotationName: row.rotation.name,
  }));
}

/** Unfiltered reads used by the tenancy suite. */

export async function listRotationsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.dutyRotation.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listAssignmentsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.dutyAssignment.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listFinesForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.dsnyFine.findMany({ select: { id: true, buildingId: true } }),
  );
}
