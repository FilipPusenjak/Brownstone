import { can } from "~/lib/auth/capabilities";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { optionalUnitFilter } from "../visibility";

/**
 * Repair tickets.
 *
 * Scoped with `optionalUnitFilter` rather than `unitFilter`, and the difference
 * is the module's whole shape: a ticket with no unit is about the front door or
 * the boiler, which is everybody's business, while a ticket against 3R is
 * private to 3R and the officers. A broken stoop everyone can see and a leak in
 * one apartment are not the same kind of fact.
 *
 * The column that matters is `responsibility`. Every repair in a co-op turns
 * into the same argument — is this the shareholder's or the corporation's? — and
 * the answer belongs in writing with an officer's name on it, not in somebody's
 * memory of a conversation two boards ago.
 */

const TICKET_SELECT = {
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
  updatedAt: true,
  resolvedAt: true,
  closedAt: true,
  vendorName: true,
  vendorPhone: true,
  triagedAt: true,
  resolutionNote: true,
  costCents: true,
  approvalRequestId: true,
  unit: { select: { id: true, label: true } },
  reportedBy: {
    select: { id: true, user: { select: { name: true, email: true } } },
  },
  assignee: {
    select: { id: true, title: true, user: { select: { name: true, email: true } } },
  },
  triagedBy: { select: { user: { select: { name: true, email: true } } } },
  resolvedBy: { select: { user: { select: { name: true, email: true } } } },
} as const;

const APPROVAL_SELECT = {
  id: true,
  kind: true,
  status: true,
  submittedAt: true,
  decidedAt: true,
  decisionNote: true,
  conditions: true,
  withdrawnAt: true,
  submittedById: true,
  submittedBy: { select: { user: { select: { name: true, email: true } } } },
  decidedBy: { select: { user: { select: { name: true, email: true } } } },
} as const;

export async function listTickets(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.ticket.findMany({
      where: optionalUnitFilter(ctx, "ticket"),
      // Open work first, and within that the loudest first: an emergency at the
      // bottom of a list sorted by date is an emergency nobody sees.
      orderBy: [{ status: "asc" }, { priority: "desc" }, { createdAt: "desc" }],
      select: TICKET_SELECT,
    }),
  );
}

/**
 * One ticket, with its determination thread and its photos.
 *
 * Returns null rather than throwing when the ticket is outside this member's
 * unit scope, so the page renders a 404 — "this exists but is not yours" is
 * itself a disclosure in a twelve-unit building.
 */
export async function getTicket(ctx: BuildingContext, ticketId: string) {
  return withBuildingTx(ctx.building.id, async (tx) => {
    const ticket = await tx.ticket.findUnique({
      where: { id: ticketId },
      select: TICKET_SELECT,
    });
    if (!ticket) return null;

    const visible =
      can(ctx, "ticket.viewAll") ||
      ticket.unitId === null ||
      ctx.unitIds.includes(ticket.unitId);
    if (!visible) return null;

    const boardOnly = can(ctx, "ticket.decideResponsibility");

    const [approval, comments, photos, charges] = await Promise.all([
      ticket.approvalRequestId
        ? tx.approvalRequest.findUnique({
            where: { id: ticket.approvalRequestId },
            select: APPROVAL_SELECT,
          })
        : Promise.resolve(null),

      ticket.approvalRequestId
        ? tx.approvalComment.findMany({
            where: {
              requestId: ticket.approvalRequestId,
              // A shareholder arguing their own case must not see the board
              // talking about it. Filtered in the query, not in the view.
              ...(boardOnly ? {} : { visibility: "SHARED" }),
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

      tx.documentLink.findMany({
        where: { entityType: "TICKET", entityId: ticketId },
        orderBy: { createdAt: "asc" },
        select: {
          document: {
            select: {
              id: true,
              title: true,
              type: true,
              contentType: true,
              sizeBytes: true,
              deletedAt: true,
              createdAt: true,
              uploadedBy: { select: { user: { select: { name: true } } } },
            },
          },
        },
      }),

      tx.charge.findMany({
        where: { ticketId },
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          unitId: true,
          amountCents: true,
          dueOn: true,
          memo: true,
          reversesChargeId: true,
          unit: { select: { label: true } },
        },
      }),
    ]);

    return {
      ...ticket,
      approval,
      comments,
      // Soft-deleted documents stay in the table because a record that pointed
      // at one should still say it existed; they just aren't shown.
      photos: photos.map((link) => link.document).filter((doc) => !doc.deletedAt),
      charges,
    };
  });
}

export type TicketDetail = NonNullable<Awaited<ReturnType<typeof getTicket>>>;

/** Charges against a ticket that have not been reversed. */
export function liveCharges(charges: TicketDetail["charges"]): TicketDetail["charges"] {
  const reversed = new Set(
    charges.map((c) => c.reversesChargeId).filter((id): id is string => Boolean(id)),
  );
  return charges.filter((c) => !c.reversesChargeId && !reversed.has(c.id));
}

/** Members a ticket can be handed to — in these buildings, mostly the super. */
export async function listAssignees(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.membership.findMany({
      where: { status: "ACTIVE" },
      orderBy: { joinedOn: "asc" },
      select: {
        id: true,
        roles: true,
        title: true,
        user: { select: { name: true, email: true } },
      },
    }),
  );
}

/** Unfiltered read used by the tenancy suite. */
export async function listTicketsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.ticket.findMany({ select: { id: true, buildingId: true } }),
  );
}
