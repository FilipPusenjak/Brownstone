import type { ResourceKind } from "~/generated/prisma/enums";
import { assertCan, can } from "~/lib/auth/capabilities";
import { windowFor, type SlotShape } from "~/lib/primitives/bookings";
import {
  PREREQUISITE_TYPES,
  type PrerequisiteType,
} from "~/lib/primitives/prerequisites";
import { fail, ok, type Failure, type Result } from "~/lib/result";
import { toDbDate, today, toPlainDate, type PlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx, type ScopedTx } from "../tx";
import { recordAudit } from "./audit";
import { canSeeBookingDetail, evaluateWithin, holdsTheSlot } from "./bookings";

/**
 * Booking the freight elevator, and the two rules that make it more than a
 * calendar.
 *
 * **A slot is held, not confirmed.** Requesting takes the time off the
 * calendar so nobody else plans a move into it; confirming is a separate act
 * that runs the resource's conditions and records what it found. Collapsing
 * the two would mean either confirming bookings whose conditions are not met,
 * or leaving the slot open while a shareholder chases a certificate — and the
 * second is how two families end up hiring movers for the same Saturday.
 *
 * **The conditions are read against the day of the move.** Not against today.
 * A booking is made three weeks out, and the certificate that covers it has to
 * be current on the day the truck arrives. Checking on the day of the request
 * passes a policy that lapses in between, which is the single failure this
 * module exists to prevent.
 *
 * Two smaller things, both stated where they are enforced. Nothing can be
 * double-booked, and that is a Postgres exclusion constraint rather than only
 * the read-then-write check below — two people pressing the same slot in the
 * same second both read an empty calendar. And the deposit never touches the
 * maintenance ledger, because the building is holding the money rather than
 * being owed it.
 */

/** Longer than this is not a booking of the elevator, it is a sublet. */
const MAX_SLOTS = 6;

/** Nobody needs to reserve the freight elevator for a move in 2031. */
const MAX_DAYS_AHEAD = 365;

const MAX_CENTS = 10_000_000;

/** Postgres raises this when the exclusion constraint refuses an overlap. */
const EXCLUSION_VIOLATION = "23P01";

function isOverlapViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  const meta = (error as { meta?: { code?: string } } | null)?.meta?.code;
  return code === EXCLUSION_VIOLATION || meta === EXCLUSION_VIOLATION;
}

interface BookingRow {
  readonly id: string;
  readonly unitId: string;
  readonly resourceId: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly status: string;
  readonly depositCents: number | null;
  readonly depositReceivedOn: Date | null;
  readonly depositReturnedOn: Date | null;
  readonly unit: { label: string };
  readonly resource: {
    name: string;
    prerequisites: Array<{ id: string; type: string; config: unknown }>;
  };
}

const BOOKING_SELECT = {
  id: true,
  unitId: true,
  resourceId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  depositCents: true,
  depositReceivedOn: true,
  depositReturnedOn: true,
  unit: { select: { label: true } },
  resource: {
    select: {
      name: true,
      prerequisites: { select: { id: true, type: true, config: true } },
    },
  },
} as const;

/**
 * Booking needs either capability, not `booking.request` alone.
 *
 * A shareholder books for their own apartment. The super has no apartment at
 * all and holds `booking.manage` without `booking.request`, and they are
 * precisely the person who needs to put a contractor's van on the calendar.
 * Insisting on the shareholder's capability would leave the one person who runs
 * the building unable to book anything in it.
 */
function assertMayBook(ctx: BuildingContext): void {
  if (!can(ctx, "booking.request") && !can(ctx, "booking.manage")) {
    assertCan(ctx, "booking.request");
  }
}

async function visibleBooking(
  tx: ScopedTx,
  ctx: BuildingContext,
  bookingId: string,
): Promise<{ ok: true; booking: BookingRow } | { ok: false; failure: Failure }> {
  const booking = await tx.booking.findUnique({
    where: { id: bookingId },
    select: BOOKING_SELECT,
  });

  // Not found and not yours read the same. In a twelve-unit building, "it
  // exists but is not yours" is itself a disclosure.
  if (!booking || !canSeeBookingDetail(ctx, booking.unitId)) {
    return { ok: false, failure: fail("not_found", "No such booking.") };
  }
  return { ok: true, booking };
}

// ---------------------------------------------------------------------------
// Requesting
// ---------------------------------------------------------------------------

export interface RequestBookingInput {
  readonly resourceId: string;
  readonly unitId: string;
  readonly date: PlainDate;
  readonly slotIndex: number;
  readonly slots: number;
  readonly note: string | null;
}

/**
 * Takes a slot off the calendar.
 *
 * The window is derived from the resource's own slot shape rather than posted,
 * so a booking that starts at ten past nine, or runs past closing, or crosses
 * midnight, is not something a caller can ask for — valid or not, it is not
 * expressible.
 */
export async function requestBooking(
  ctx: BuildingContext,
  input: RequestBookingInput,
): Promise<Result<{ bookingId: string }>> {
  assertMayBook(ctx);

  // A shareholder books for their own apartment. An officer books for any,
  // because somebody has to be able to put the super's contractor on the
  // calendar.
  if (!can(ctx, "booking.manage") && !ctx.unitIds.includes(input.unitId)) {
    return fail(
      "forbidden",
      "You can only book for your own apartment. Ask the board to book this one.",
    );
  }

  if (input.note && input.note.length > 500) {
    return fail("invalid", "That note is too long.");
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const resource = await tx.resource.findUnique({
      where: { id: input.resourceId },
      select: {
        id: true,
        name: true,
        active: true,
        slotMinutes: true,
        opensMinute: true,
        closesMinute: true,
      },
    });
    if (!resource) return fail("not_found", "No such thing to book.");
    if (!resource.active) {
      return fail("conflict", `${resource.name} isn't bookable at the moment.`);
    }

    const unit = await tx.unit.findUnique({
      where: { id: input.unitId },
      select: { id: true, label: true },
    });
    if (!unit) return fail("not_found", "No such apartment.");

    if (input.slots > MAX_SLOTS) {
      return fail(
        "invalid",
        `${MAX_SLOTS} slots is the most one booking can take. A move longer than that is worth splitting across days so somebody else can get in.`,
      );
    }

    const shape: SlotShape = resource;
    const window = windowFor(
      shape,
      input.date,
      ctx.building.timezone,
      input.slotIndex,
      input.slots,
    );
    if (!window) {
      return fail(
        "invalid",
        `That doesn't fit inside ${resource.name}'s hours on ${input.date}.`,
      );
    }

    if (window.startsAt.getTime() <= Date.now()) {
      return fail("invalid", "That slot has already started.");
    }

    const horizon = new Date(Date.now() + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000);
    if (window.startsAt > horizon) {
      return fail(
        "invalid",
        `That's more than a year out. Book it closer to the day — the calendar is shared.`,
      );
    }

    // Checked here so the refusal can name who has the slot. The database
    // enforces the same rule underneath, for the two requests that arrive
    // together and both read this as clear.
    const clash = await tx.booking.findFirst({
      where: {
        resourceId: resource.id,
        status: { in: ["HELD", "CONFIRMED"] },
        startsAt: { lt: window.endsAt },
        endsAt: { gt: window.startsAt },
      },
      select: { unit: { select: { label: true } } },
    });
    if (clash) {
      return fail(
        "conflict",
        `${clash.unit.label} already has ${resource.name} then. Pick another slot.`,
      );
    }

    let bookingId: string;
    try {
      const created = await tx.booking.create({
        data: {
          buildingId: ctx.building.id,
          resourceId: resource.id,
          unitId: unit.id,
          requestedById: ctx.membership.id,
          startsAt: window.startsAt,
          endsAt: window.endsAt,
          status: "HELD",
          note: input.note,
        },
        select: { id: true },
      });
      bookingId = created.id;
    } catch (error) {
      if (isOverlapViolation(error)) {
        return fail(
          "conflict",
          `Somebody took ${resource.name} for that slot a moment ago. Pick another.`,
        );
      }
      throw error;
    }

    await recordAudit(tx, ctx, {
      action: "booking.request",
      entityType: "BOOKING",
      entityId: bookingId,
      after: { resource: resource.name, unit: unit.label, date: input.date },
      summary: `${unit.label} held ${resource.name} on ${input.date}`,
    });

    return ok({ bookingId });
  });
}

// ---------------------------------------------------------------------------
// Confirming
// ---------------------------------------------------------------------------

/**
 * Runs the conditions and, if they all hold, confirms.
 *
 * The outcome of every condition is written down either way. A shareholder who
 * is refused should be able to see exactly which of them failed and when it was
 * checked, rather than being told "not yet" by a board member who has moved on
 * to something else.
 *
 * Every condition is evaluated, never short-circuited: somebody missing both a
 * deposit and a certificate is told both at once instead of discovering the
 * second after fixing the first.
 */
export async function confirmBooking(
  ctx: BuildingContext,
  bookingId: string,
): Promise<Result<{ satisfied: boolean; unmet: string[] }>> {
  assertCan(ctx, "booking.manage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleBooking(tx, ctx, bookingId);
    if (!found.ok) return found.failure;
    const booking = found.booking;

    if (booking.status === "CANCELLED") {
      return fail("conflict", "That booking was cancelled. Request the slot again.");
    }
    if (booking.status === "COMPLETED") {
      return fail("conflict", "That booking has already been and gone.");
    }
    if (booking.endsAt.getTime() <= Date.now()) {
      return fail(
        "conflict",
        "That slot is in the past. Confirming it now would record a decision nobody could have acted on.",
      );
    }

    const evaluation = await evaluateWithin(tx, {
      unitId: booking.unitId,
      startsAt: booking.startsAt,
      depositCents: booking.depositCents,
      depositReceivedOn: booking.depositReceivedOn,
      depositReturnedOn: booking.depositReturnedOn,
      resource: booking.resource,
    });

    // Written before the decision, and for the failures too — the record of
    // what was true when somebody looked is the useful part.
    for (const outcome of evaluation.outcomes) {
      await tx.bookingPrerequisiteCheck.upsert({
        where: {
          bookingId_prerequisiteId: {
            bookingId: booking.id,
            prerequisiteId: outcome.prerequisiteId,
          },
        },
        create: {
          buildingId: ctx.building.id,
          bookingId: booking.id,
          prerequisiteId: outcome.prerequisiteId,
          satisfied: outcome.satisfied,
          note: outcome.message,
          ...(outcome.evidenceId
            ? {
                evidenceType: "CERTIFICATE_OF_INSURANCE" as const,
                evidenceId: outcome.evidenceId,
              }
            : {}),
        },
        update: {
          satisfied: outcome.satisfied,
          note: outcome.message,
          checkedAt: new Date(),
          evidenceType: outcome.evidenceId ? "CERTIFICATE_OF_INSURANCE" : null,
          evidenceId: outcome.evidenceId ?? null,
        },
      });
    }

    const unmet = evaluation.outcomes
      .filter((outcome) => !outcome.satisfied)
      .map((outcome) => outcome.message);

    if (!evaluation.satisfied) {
      await recordAudit(tx, ctx, {
        action: "booking.checkFailed",
        entityType: "BOOKING",
        entityId: booking.id,
        after: { unmet },
        summary: `${booking.unit.label}'s ${booking.resource.name} booking is not clear to go ahead`,
      });
      return fail("conflict", `Not yet. ${unmet.join(" ")}`);
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        confirmedById: ctx.membership.id,
      },
    });

    await recordAudit(tx, ctx, {
      action: "booking.confirm",
      entityType: "BOOKING",
      entityId: booking.id,
      before: { status: booking.status },
      after: { status: "CONFIRMED" },
      summary: `${booking.resource.name} confirmed for ${booking.unit.label}`,
    });

    return ok({ satisfied: true, unmet: [] });
  });
}

// ---------------------------------------------------------------------------
// Cancelling
// ---------------------------------------------------------------------------

export async function cancelBooking(
  ctx: BuildingContext,
  bookingId: string,
  reason: string | null,
): Promise<Result<null>> {
  assertMayBook(ctx);

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleBooking(tx, ctx, bookingId);
    if (!found.ok) return found.failure;
    const booking = found.booking;

    if (!holdsTheSlot(booking.status)) {
      return fail("conflict", "That booking is not holding a slot.");
    }

    // The apartment may give up its own slot; the board may cancel any. Neither
    // needs a reason, but a board cancelling somebody else's move should say
    // why, and the form asks.
    const own = ctx.unitIds.includes(booking.unitId);
    if (!own && !can(ctx, "booking.manage")) {
      return fail("forbidden", "That isn't your booking to cancel.");
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        cancelledById: ctx.membership.id,
        cancelledReason: reason,
      },
    });

    await recordAudit(tx, ctx, {
      action: "booking.cancel",
      entityType: "BOOKING",
      entityId: booking.id,
      before: { status: booking.status },
      after: { status: "CANCELLED", reason },
      summary: `${booking.resource.name} on ${toPlainDate(booking.startsAt)} released by ${booking.unit.label}`,
    });

    // The deposit outlives the cancellation on purpose. Whoever is holding the
    // cheque still has it, and returning it is a separate act somebody has to
    // perform and record.
    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// The deposit
// ---------------------------------------------------------------------------

/**
 * Records that the building received a deposit.
 *
 * Recorded, not collected — Co-operator has no payment processor and never
 * touches money. What this writes down is that a cheque arrived, for how much,
 * and with what reference, so the treasurer can find it again when it is time
 * to give it back.
 *
 * It is not a ledger entry. A charge means "this apartment owes us"; a deposit
 * means "we are holding their cheque". Posting the second as the first makes
 * the arrears report wrong, and the arrears report is the one number a board
 * acts on.
 */
export async function recordDeposit(
  ctx: BuildingContext,
  bookingId: string,
  input: { amountCents: number; receivedOn: PlainDate; reference: string | null },
): Promise<Result<null>> {
  assertCan(ctx, "booking.manage");

  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return fail("invalid", "Enter the amount received.");
  }
  if (input.amountCents > MAX_CENTS) {
    return fail("invalid", "That is larger than any move deposit. Check the figure.");
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleBooking(tx, ctx, bookingId);
    if (!found.ok) return found.failure;
    const booking = found.booking;

    if (booking.depositReturnedOn) {
      return fail(
        "conflict",
        "That deposit has already been returned. Recording another would say the building holds money it gave back.",
      );
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        depositCents: input.amountCents,
        depositReceivedOn: toDbDate(input.receivedOn),
        depositReference: input.reference,
      },
    });

    await recordAudit(tx, ctx, {
      action: "booking.recordDeposit",
      entityType: "BOOKING",
      entityId: booking.id,
      after: {
        amountCents: input.amountCents,
        receivedOn: input.receivedOn,
        reference: input.reference,
      },
      summary: `Deposit recorded for ${booking.unit.label}'s ${booking.resource.name} booking`,
    });

    return ok(null);
  });
}

/**
 * Gives the deposit back, in full or in part, and closes the booking out.
 *
 * Not before the slot has been and gone: a deposit exists to cover what happens
 * during the move, and returning it in advance is the same as not taking one.
 * The exception is a booking that was cancelled, where there is nothing left to
 * cover.
 *
 * Anything withheld is recorded here with a reason and does not become a
 * charge, because the building already has the money. Damage costing more than
 * the deposit is a different thing entirely — a repair the board determines is
 * the shareholder's, billed through the repairs module, where the
 * determination is on the record next to the bill.
 */
export async function returnDeposit(
  ctx: BuildingContext,
  bookingId: string,
  input: { returnedOn: PlainDate; withheldCents: number; note: string | null },
): Promise<Result<null>> {
  assertCan(ctx, "booking.manage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleBooking(tx, ctx, bookingId);
    if (!found.ok) return found.failure;
    const booking = found.booking;

    if (!booking.depositReceivedOn) {
      return fail("conflict", "No deposit was recorded against this booking.");
    }
    if (booking.depositReturnedOn) {
      return fail("conflict", "That deposit has already been returned.");
    }

    const held = booking.depositCents ?? 0;
    if (!Number.isInteger(input.withheldCents) || input.withheldCents < 0) {
      return fail("invalid", "Enter how much is being kept, or zero.");
    }
    if (input.withheldCents > held) {
      return fail(
        "invalid",
        "You cannot keep more than the deposit. Damage beyond it is a repair the board has to determine responsibility for, and that gets billed with the determination attached.",
      );
    }
    if (input.withheldCents > 0 && !input.note?.trim()) {
      return fail(
        "invalid",
        "Say what the money is being kept for. A deduction nobody explained is the one that gets disputed.",
      );
    }

    if (booking.status !== "CANCELLED" && booking.endsAt.getTime() > Date.now()) {
      return fail(
        "conflict",
        "That booking hasn't happened yet. A deposit returned before the move is the same as not taking one.",
      );
    }

    await tx.booking.update({
      where: { id: booking.id },
      data: {
        depositReturnedOn: toDbDate(input.returnedOn),
        depositWithheldCents: input.withheldCents,
        depositNote: input.note,
        // A cancelled booking stays cancelled; one that ran is now finished.
        ...(booking.status === "CANCELLED" ? {} : { status: "COMPLETED" as const }),
      },
    });

    await recordAudit(tx, ctx, {
      action: "booking.returnDeposit",
      entityType: "BOOKING",
      entityId: booking.id,
      after: {
        returnedOn: input.returnedOn,
        withheldCents: input.withheldCents,
        note: input.note,
      },
      summary:
        input.withheldCents > 0
          ? `Deposit returned to ${booking.unit.label} less ${input.withheldCents / 100} kept`
          : `Deposit returned in full to ${booking.unit.label}`,
    });

    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// What can be booked
// ---------------------------------------------------------------------------

export interface AddResourceInput {
  readonly name: string;
  readonly kind: ResourceKind;
  readonly slotMinutes: number;
  readonly opensMinute: number;
  readonly closesMinute: number;
  readonly prerequisites: ReadonlyArray<{
    readonly type: PrerequisiteType;
    readonly config: Record<string, unknown>;
  }>;
}

/**
 * Adds something to the list of what the building schedules.
 *
 * This is the claim the prerequisites registry was built to make good on: the
 * roof deck arrives as a row, with its conditions picked from the same registry
 * the freight elevator uses, and nothing in the checking, the calendar or the
 * confirmation path changes to accommodate it.
 */
export async function addResource(
  ctx: BuildingContext,
  input: AddResourceInput,
): Promise<Result<{ resourceId: string }>> {
  assertCan(ctx, "booking.manage");

  const name = input.name.trim();
  if (!name) return fail("invalid", "Give it the name people call it by.");
  if (name.length > 80) return fail("invalid", "That name is too long.");

  if (!Number.isInteger(input.slotMinutes) || input.slotMinutes < 15) {
    return fail("invalid", "A slot shorter than fifteen minutes is not a booking.");
  }
  if (input.opensMinute < 0 || input.closesMinute > 24 * 60) {
    return fail("invalid", "Opening hours have to fall inside a day.");
  }
  if (input.closesMinute - input.opensMinute < input.slotMinutes) {
    return fail(
      "invalid",
      "Those hours are shorter than one slot, so the day would hold nothing.",
    );
  }

  for (const prerequisite of input.prerequisites) {
    if (!PREREQUISITE_TYPES.includes(prerequisite.type)) {
      return fail("invalid", `There is no check called ${prerequisite.type}.`);
    }
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const existing = await tx.resource.findFirst({
      where: { name, active: true },
      select: { id: true },
    });
    if (existing) {
      return fail("conflict", `${name} is already on the list.`);
    }

    const resource = await tx.resource.create({
      data: {
        buildingId: ctx.building.id,
        name,
        kind: input.kind,
        slotMinutes: input.slotMinutes,
        opensMinute: input.opensMinute,
        closesMinute: input.closesMinute,
      },
      select: { id: true },
    });

    if (input.prerequisites.length > 0) {
      await tx.resourcePrerequisite.createMany({
        data: input.prerequisites.map((prerequisite) => ({
          buildingId: ctx.building.id,
          resourceId: resource.id,
          type: prerequisite.type,
          config: prerequisite.config as never,
        })),
      });
    }

    await recordAudit(tx, ctx, {
      action: "booking.addResource",
      entityType: "BUILDING",
      entityId: ctx.building.id,
      after: {
        name,
        kind: input.kind,
        conditions: input.prerequisites.map((p) => p.type),
      },
      summary: `${name} added to what the building schedules`,
    });

    return ok({ resourceId: resource.id });
  });
}

/** Stops a resource being booked without touching what is already on it. */
export async function retireResource(
  ctx: BuildingContext,
  resourceId: string,
): Promise<Result<null>> {
  assertCan(ctx, "booking.manage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const resource = await tx.resource.findUnique({
      where: { id: resourceId },
      select: { id: true, name: true, active: true },
    });
    if (!resource) return fail("not_found", "No such thing to book.");
    if (!resource.active)
      return fail("conflict", `${resource.name} is already off the list.`);

    await tx.resource.update({
      where: { id: resource.id },
      data: { active: false },
    });

    // Deliberately not cancelling what is already booked. Somebody has hired
    // movers for next Saturday, and taking the roof deck off the list is not a
    // decision to cancel their party.
    const upcoming = await tx.booking.count({
      where: {
        resourceId: resource.id,
        status: { in: ["HELD", "CONFIRMED"] },
        startsAt: { gt: new Date(`${today(ctx.building.timezone)}T00:00:00Z`) },
      },
    });

    await recordAudit(tx, ctx, {
      action: "booking.retireResource",
      entityType: "BUILDING",
      entityId: ctx.building.id,
      before: { name: resource.name, active: true },
      after: { name: resource.name, active: false, upcomingBookingsKept: upcoming },
      summary: `${resource.name} taken off what the building schedules`,
    });

    return ok(null);
  });
}
