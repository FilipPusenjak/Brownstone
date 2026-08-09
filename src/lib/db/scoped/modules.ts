import { assertCan } from "~/lib/auth/capabilities";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { optionalUnitFilter, unitFilter } from "../visibility";

/**
 * Read queries for the seven scaffolded modules.
 *
 * These are real, scoped, capability-checked reads over real seeded data —
 * enough for each module's list view to show the building something true. What
 * is missing from each module is written down in its `TODO.md`; nothing here
 * pretends to be finished.
 *
 * When one of these modules is built out, its queries move to a module of their
 * own. Nothing about tenancy, capabilities or the primitives needs to change to
 * do that, which is the point of the exercise.
 */

// --- Meetings & proxies ----------------------------------------------------

export async function listMeetings(ctx: BuildingContext) {
  assertCan(ctx, "meeting.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.meeting.findMany({
      orderBy: { scheduledFor: "desc" },
      select: {
        id: true,
        buildingId: true,
        title: true,
        type: true,
        scheduledFor: true,
        location: true,
        quorumNumerator: true,
        quorumDenominator: true,
        quorumStrict: true,
        heldAt: true,
        _count: { select: { attendance: true, proxies: true, resolutions: true } },
      },
    }),
  );
}

export async function listProxies(ctx: BuildingContext) {
  assertCan(ctx, "meeting.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.proxy.findMany({
      select: {
        id: true,
        buildingId: true,
        meetingId: true,
        unitId: true,
        holderName: true,
        revokedAt: true,
      },
    }),
  );
}

export async function listMeetingAttendance(ctx: BuildingContext) {
  assertCan(ctx, "meeting.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.meetingAttendance.findMany({
      select: { id: true, buildingId: true, meetingId: true, unitId: true, mode: true },
    }),
  );
}

export async function listResolutions(ctx: BuildingContext) {
  assertCan(ctx, "meeting.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.resolution.findMany({
      select: {
        id: true,
        buildingId: true,
        meetingId: true,
        title: true,
        sharesFor: true,
        sharesAgainst: true,
        sharesAbstain: true,
        passed: true,
      },
    }),
  );
}

// --- Sublet register -------------------------------------------------------

export async function listSublets(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.subletRegistration.findMany({
      where: unitFilter(ctx, "sublet"),
      orderBy: { termEnd: "asc" },
      select: {
        id: true,
        buildingId: true,
        unitId: true,
        subtenantName: true,
        termStart: true,
        termEnd: true,
        feeCents: true,
        unit: { select: { id: true, label: true } },
        approval: { select: { id: true, status: true, decidedAt: true } },
      },
    }),
  );
}

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

// --- Repair tickets --------------------------------------------------------

export async function listTickets(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.ticket.findMany({
      // Tickets for the stoop or the boiler room belong to no unit and are
      // everyone's business; unit-linked ones follow the usual scoping.
      where: optionalUnitFilter(ctx, "ticket"),
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        buildingId: true,
        unitId: true,
        title: true,
        detail: true,
        area: true,
        status: true,
        priority: true,
        responsibility: true,
        createdAt: true,
        resolvedAt: true,
        unit: { select: { id: true, label: true } },
        reportedBy: {
          select: { id: true, user: { select: { name: true, email: true } } },
        },
      },
    }),
  );
}

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
