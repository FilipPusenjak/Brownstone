import { can } from "~/lib/auth/capabilities";
import {
  overlaps,
  slotsOn,
  type Interval,
  type SlotShape,
} from "~/lib/primitives/bookings";
import { balance } from "~/lib/primitives/ledger";
import {
  evaluatePrerequisites,
  type PrerequisiteConfig,
  type PrerequisiteFacts,
  type PrerequisiteOutcome,
  type PrerequisiteType,
} from "~/lib/primitives/prerequisites";
import { toPlainDate, type PlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx, type ScopedTx } from "../tx";

/**
 * What can be booked, what is booked, and whether it may go ahead.
 *
 * The visibility rule here is different from every other unit-scoped module,
 * and deliberately so. **When the freight elevator is taken is public; why it
 * is taken is not.** A calendar that hides its bookings is not a calendar — a
 * neighbour planning their own move has to be able to see that Saturday
 * morning is gone, and they will see the truck anyway. What stays private is
 * everything underneath: the note, the deposit, and which conditions this
 * apartment has and has not met. Those are the unit's business and the board's.
 *
 * The other thing this module insists on is *when* the conditions are read. A
 * mover's certificate is checked against the day of the move, never against
 * today. A booking made three weeks out with a certificate that lapses the day
 * before is the exact failure the check exists to catch, and reading it on the
 * day of the request waves it through.
 */

/** Fields anybody in the building may see. The slot itself. */
const PUBLIC_SELECT = {
  id: true,
  buildingId: true,
  resourceId: true,
  unitId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  confirmedAt: true,
  cancelledAt: true,
  createdAt: true,
  unit: { select: { id: true, label: true } },
  resource: {
    select: {
      id: true,
      name: true,
      kind: true,
      slotMinutes: true,
      opensMinute: true,
      closesMinute: true,
    },
  },
} as const;

/** Everything else. Only for the apartment involved and for the board. */
const PRIVATE_SELECT = {
  note: true,
  cancelledReason: true,
  depositCents: true,
  depositReceivedOn: true,
  depositReference: true,
  depositReturnedOn: true,
  depositWithheldCents: true,
  depositNote: true,
  requestedBy: { select: { user: { select: { name: true, email: true } } } },
  confirmedBy: { select: { user: { select: { name: true, email: true } } } },
  cancelledBy: { select: { user: { select: { name: true, email: true } } } },
  checks: {
    select: {
      id: true,
      prerequisiteId: true,
      satisfied: true,
      checkedAt: true,
      note: true,
      evidenceId: true,
      prerequisite: { select: { id: true, type: true, config: true } },
    },
  },
} as const;

/** Whether this member may see a booking's note, deposit and checks. */
export function canSeeBookingDetail(ctx: BuildingContext, unitId: string): boolean {
  return can(ctx, "booking.manage") || ctx.unitIds.includes(unitId);
}

/** A booking still holding its slot. Cancelled ones give the time back. */
export function holdsTheSlot(status: string): boolean {
  return status === "HELD" || status === "CONFIRMED";
}

export async function listResources(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.resource.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
      select: {
        id: true,
        buildingId: true,
        name: true,
        kind: true,
        slotMinutes: true,
        opensMinute: true,
        closesMinute: true,
        active: true,
        prerequisites: {
          orderBy: { type: "asc" },
          select: { id: true, type: true, config: true },
        },
      },
    }),
  );
}

export type BookableResource = Awaited<ReturnType<typeof listResources>>[number];

/**
 * Every booking, with the private half blanked for members who may not see it.
 *
 * Blanked at the query layer rather than in the page, so a component added
 * later cannot render a field it was never handed.
 */
export async function listBookings(ctx: BuildingContext) {
  const rows = await withBuildingTx(ctx.building.id, (tx) =>
    tx.booking.findMany({
      orderBy: { startsAt: "desc" },
      select: { ...PUBLIC_SELECT, ...PRIVATE_SELECT },
    }),
  );

  return rows.map((row) => (canSeeBookingDetail(ctx, row.unitId) ? row : redact(row)));
}

export type BookingRow = Awaited<ReturnType<typeof listBookings>>[number];

function redact<T extends { unitId: string }>(row: T): T {
  return {
    ...row,
    note: null,
    cancelledReason: null,
    depositCents: null,
    depositReceivedOn: null,
    depositReference: null,
    depositReturnedOn: null,
    depositWithheldCents: null,
    depositNote: null,
    requestedBy: null,
    confirmedBy: null,
    cancelledBy: null,
    checks: [],
  };
}

export async function getBooking(ctx: BuildingContext, bookingId: string) {
  const booking = await withBuildingTx(ctx.building.id, (tx) =>
    tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        ...PUBLIC_SELECT,
        ...PRIVATE_SELECT,
        resource: {
          select: {
            id: true,
            name: true,
            kind: true,
            slotMinutes: true,
            opensMinute: true,
            closesMinute: true,
            prerequisites: {
              orderBy: { type: "asc" },
              select: { id: true, type: true, config: true },
            },
          },
        },
      },
    }),
  );
  if (!booking) return null;

  const detailed = canSeeBookingDetail(ctx, booking.unitId);

  // Derived here rather than in the page. Reading the clock is a query's job,
  // and a component that does it re-renders into a different answer.
  return {
    ...(detailed ? booking : redact(booking)),
    detailed,
    hasHappened: booking.endsAt.getTime() <= Date.now(),
  };
}

export type BookingDetail = NonNullable<Awaited<ReturnType<typeof getBooking>>>;

/**
 * The conditions, evaluated against live facts, as of the day of the booking.
 *
 * Read-only and available to anybody who may see the booking's detail, so a
 * shareholder can find out what is still outstanding without an officer having
 * to press anything. The board's confirm button runs the same evaluation and
 * writes the result down; this one only reports it.
 */
export async function evaluateBooking(
  ctx: BuildingContext,
  bookingId: string,
): Promise<{
  readonly satisfied: boolean;
  readonly outcomes: PrerequisiteOutcome[];
} | null> {
  return withBuildingTx(ctx.building.id, async (tx) => {
    const booking = await tx.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        unitId: true,
        startsAt: true,
        depositCents: true,
        depositReceivedOn: true,
        depositReturnedOn: true,
        resource: {
          select: {
            prerequisites: { select: { id: true, type: true, config: true } },
          },
        },
      },
    });
    if (!booking || !canSeeBookingDetail(ctx, booking.unitId)) return null;

    return evaluateWithin(tx, booking);
  });
}

interface EvaluableBooking {
  readonly unitId: string;
  readonly startsAt: Date;
  readonly depositCents: number | null;
  readonly depositReceivedOn: Date | null;
  readonly depositReturnedOn: Date | null;
  readonly resource: {
    readonly prerequisites: ReadonlyArray<{
      id: string;
      type: string;
      config: unknown;
    }>;
  };
}

/** The same evaluation, inside a caller's transaction. Used at confirmation. */
export async function evaluateWithin(tx: ScopedTx, booking: EvaluableBooking) {
  const facts = await bookingFacts(tx, booking);

  return evaluatePrerequisites(
    booking.resource.prerequisites.map((prerequisite) => ({
      id: prerequisite.id,
      type: prerequisite.type as PrerequisiteType,
      config: (prerequisite.config ?? {}) as PrerequisiteConfig,
    })),
    facts,
  );
}

/**
 * The facts the checkers run against.
 *
 * Gathering them is deliberately separate from checking them: the checkers are
 * pure and testable without a database, and the queries live here where the
 * tenant scope applies.
 *
 * Certificates are narrowed to third parties — a mover, a contractor, a vendor.
 * A shareholder's own homeowner policy is a real certificate on file and is not
 * what "the movers must be insured" means, and a check that accepted it would
 * pass every apartment that has ever filed anything.
 */
async function bookingFacts(
  tx: ScopedTx,
  booking: EvaluableBooking,
): Promise<PrerequisiteFacts> {
  const bookingDate = toPlainDate(booking.startsAt);

  const [certificates, charges, payments, alterations] = await Promise.all([
    tx.certificateOfInsurance.findMany({
      where: {
        unitId: booking.unitId,
        holderKind: { in: ["MOVER", "CONTRACTOR", "VENDOR"] },
      },
      select: {
        id: true,
        holderName: true,
        coverageCents: true,
        effectiveOn: true,
        expiresOn: true,
        additionalInsuredVerified: true,
      },
    }),
    tx.charge.findMany({
      where: { unitId: booking.unitId },
      select: {
        id: true,
        unitId: true,
        amountCents: true,
        dueOn: true,
        reversesChargeId: true,
      },
    }),
    tx.payment.findMany({
      where: { unitId: booking.unitId },
      select: {
        id: true,
        unitId: true,
        amountCents: true,
        receivedOn: true,
        reversesPaymentId: true,
      },
    }),
    tx.alterationRequest.findMany({
      where: { unitId: booking.unitId },
      select: { approval: { select: { status: true } } },
    }),
  ]);

  // Held, and not yet given back. A deposit that has been returned is money the
  // building no longer has, whatever the booking once recorded.
  const depositPaidCents =
    booking.depositReceivedOn && !booking.depositReturnedOn
      ? (booking.depositCents ?? 0)
      : 0;

  return {
    depositPaidCents,
    certificates: certificates.map((cert) => ({
      id: cert.id,
      holderName: cert.holderName,
      coverageCents: cert.coverageCents,
      effectiveOn: toPlainDate(cert.effectiveOn),
      expiresOn: toPlainDate(cert.expiresOn),
      additionalInsuredVerified: cert.additionalInsuredVerified,
    })),
    // Money is branded integer cents, so this is already the number the
    // checkers want rather than a conversion waiting to be got wrong.
    arrearsCents: balance(
      charges.map((charge) => ({
        ...charge,
        dueOn: toPlainDate(charge.dueOn),
      })),
      payments.map((payment) => ({
        ...payment,
        receivedOn: toPlainDate(payment.receivedOn),
      })),
    ),
    hasApprovedAlteration: alterations.some(
      (alteration) =>
        alteration.approval?.status === "APPROVED" ||
        alteration.approval?.status === "APPROVED_WITH_CONDITIONS",
    ),
    bookingDate,
  };
}

export interface CalendarSlot {
  readonly index: number;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly takenBy: {
    readonly id: string;
    readonly unitLabel: string;
    readonly status: string;
  } | null;
  /** Already in the past, in the building's timezone. */
  readonly gone: boolean;
}

/**
 * One resource's day, slot by slot.
 *
 * Reads the whole day's bookings and marks the slots they cover, rather than
 * asking the database per slot. The shape a caller gets back is the shape the
 * calendar renders and the shape the request form posts against — a slot index
 * on a date, never a raw pair of timestamps, so a misaligned or overnight
 * booking is not something the interface can express.
 */
export async function dayCalendar(
  ctx: BuildingContext,
  resourceId: string,
  date: PlainDate,
): Promise<{ resource: BookableResource; slots: CalendarSlot[] } | null> {
  return withBuildingTx(ctx.building.id, async (tx) => {
    const resource = await tx.resource.findUnique({
      where: { id: resourceId },
      select: {
        id: true,
        buildingId: true,
        name: true,
        kind: true,
        slotMinutes: true,
        opensMinute: true,
        closesMinute: true,
        active: true,
        prerequisites: {
          orderBy: { type: "asc" },
          select: { id: true, type: true, config: true },
        },
      },
    });
    if (!resource) return null;

    const shape: SlotShape = resource;
    const slots = slotsOn(shape, date, ctx.building.timezone);
    if (slots.length === 0) return { resource, slots: [] };

    const first = slots[0]!;
    const last = slots[slots.length - 1]!;

    const bookings = await tx.booking.findMany({
      where: {
        resourceId,
        status: { in: ["HELD", "CONFIRMED"] },
        startsAt: { lt: last.endsAt },
        endsAt: { gt: first.startsAt },
      },
      select: {
        id: true,
        startsAt: true,
        endsAt: true,
        status: true,
        unit: { select: { label: true } },
      },
    });

    const now = Date.now();

    return {
      resource,
      slots: slots.map((slot) => {
        const taken = bookings.find((booking) => overlaps(slot, booking as Interval));
        return {
          index: slot.index,
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          takenBy: taken
            ? { id: taken.id, unitLabel: taken.unit.label, status: taken.status }
            : null,
          gone: slot.startsAt.getTime() <= now,
        };
      }),
    };
  });
}

/**
 * Unfiltered reads used by the tenancy suite.
 *
 * Separate from the queries above because those filter — `listResources` hides
 * retired ones, `listBookings` blanks a neighbour's detail — and a tenancy
 * check has to see everything the tenant scope permits in order to prove it
 * permits nothing more.
 */
export async function listBookingsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.booking.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listResourcesForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.resource.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listPrerequisitesForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.resourcePrerequisite.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listBookingChecksForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.bookingPrerequisiteCheck.findMany({ select: { id: true, buildingId: true } }),
  );
}
