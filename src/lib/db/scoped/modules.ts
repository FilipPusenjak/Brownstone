import { assertCan } from "~/lib/auth/capabilities";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { unitFilter } from "../visibility";

/**
 * Read queries for the modules that are still scaffolds.
 *
 * These are real, scoped, capability-checked reads over real seeded data —
 * enough for each module's list view to show the building something true. What
 * is missing from each module is written down in its `TODO.md`; nothing here
 * pretends to be finished.
 *
 * As each module is built out its queries move to a file of their own, and the
 * markers below are what is left behind. Nothing about tenancy, capabilities or
 * the primitives has had to change to do that once, which is the point of the
 * exercise.
 */

// Meetings & proxies were built out; their queries live in `meetings.ts`.

// The sublet register was built out; its queries live in `sublets.ts`.

// --- Bookings --------------------------------------------------------------

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
        prerequisites: { select: { id: true, type: true, config: true } },
      },
    }),
  );
}

export async function listBookings(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.booking.findMany({
      orderBy: { startsAt: "desc" },
      select: {
        id: true,
        buildingId: true,
        resourceId: true,
        unitId: true,
        startsAt: true,
        endsAt: true,
        status: true,
        note: true,
        unit: { select: { id: true, label: true } },
        resource: { select: { id: true, name: true, kind: true } },
        checks: {
          select: { id: true, prerequisiteId: true, satisfied: true, note: true },
        },
      },
    }),
  );
}

export async function listResourcePrerequisites(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.resourcePrerequisite.findMany({
      select: {
        id: true,
        buildingId: true,
        resourceId: true,
        type: true,
        config: true,
      },
    }),
  );
}

export async function listBookingChecks(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.bookingPrerequisiteCheck.findMany({
      select: { id: true, buildingId: true, bookingId: true, satisfied: true },
    }),
  );
}

// Repair tickets were built out; their queries live in `tickets.ts`.

// --- Duty rotation ---------------------------------------------------------

export async function listDutyRotations(ctx: BuildingContext) {
  assertCan(ctx, "duty.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.dutyRotation.findMany({
      where: { active: true },
      select: {
        id: true,
        buildingId: true,
        name: true,
        kind: true,
        unitOrder: true,
        startsOn: true,
        periodDays: true,
      },
    }),
  );
}

export async function listDutyAssignments(ctx: BuildingContext) {
  assertCan(ctx, "duty.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.dutyAssignment.findMany({
      orderBy: { periodStart: "desc" },
      select: {
        id: true,
        buildingId: true,
        rotationId: true,
        unitId: true,
        periodStart: true,
        periodEnd: true,
        unit: { select: { id: true, label: true } },
      },
    }),
  );
}

export async function listDsnyFines(ctx: BuildingContext) {
  assertCan(ctx, "duty.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.dsnyFine.findMany({
      orderBy: { issuedOn: "desc" },
      select: {
        id: true,
        buildingId: true,
        unitId: true,
        ticketNumber: true,
        issuedOn: true,
        violation: true,
        amountCents: true,
        paidOn: true,
      },
    }),
  );
}

// --- Annual notices --------------------------------------------------------

export async function listNoticeCampaigns(ctx: BuildingContext) {
  assertCan(ctx, "notice.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.noticeCampaign.findMany({
      orderBy: [{ year: "desc" }, { noticeType: "asc" }],
      select: {
        id: true,
        buildingId: true,
        noticeType: true,
        year: true,
        dueOn: true,
        sentAt: true,
        _count: { select: { deliveries: true } },
      },
    }),
  );
}

export async function listNoticeDeliveries(ctx: BuildingContext) {
  assertCan(ctx, "notice.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.noticeDelivery.findMany({
      select: {
        id: true,
        buildingId: true,
        campaignId: true,
        unitId: true,
        recipientName: true,
        respondedAt: true,
      },
    }),
  );
}

// --- Arrears (module 6 reads live in ledger.ts) ----------------------------

export async function listPaymentPlansForModule(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.paymentPlan.findMany({
      where: unitFilter(ctx, "arrears"),
      select: {
        id: true,
        buildingId: true,
        unitId: true,
        totalCents: true,
        startsOn: true,
        endsOn: true,
      },
    }),
  );
}
