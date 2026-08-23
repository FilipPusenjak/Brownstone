import type {
  Responsibility,
  TicketPriority,
  TicketStatus,
} from "~/generated/prisma/enums";
import { assertCan, can } from "~/lib/auth/capabilities";
import {
  DECIDE_CAPABILITY,
  transition,
  type ApprovalAction,
} from "~/lib/primitives/approvals";
import { fail, ok, type Failure, type Result } from "~/lib/result";
import { toDbDate, type PlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx, type ScopedTx } from "../tx";
import { recordAudit } from "./audit";

/**
 * Repair tickets: reporting, triage, the responsibility determination, and the
 * bill that sometimes follows.
 *
 * Most of this is bookkeeping. One part is not, and it is the reason the module
 * exists: **a shareholder cannot be charged for a repair until the board has
 * determined in writing that they are the one who pays.** Who is responsible for
 * a leak — the corporation, whose pipes are behind the wall, or the shareholder,
 * whose fixture failed — is the argument every co-op repair turns into, and it
 * is decided by reading a proprietary lease, not by whoever holds the chequebook
 * that week. So the determination runs through the same approval workflow as an
 * alteration: it can be argued with in a comment thread, it is decided by a
 * named officer, and once decided it cannot be edited, only superseded.
 *
 * The money gate is enforced here rather than in the interface, because a
 * disabled button is a suggestion.
 */

/**
 * Where a ticket may go from where it is.
 *
 * Triage is not a required step. The super fixing a loose handrail the same
 * afternoon should not have to record that he considered it first — a workflow
 * that insists on ceremony for a five-minute job is a workflow people stop
 * using, and a repair log nobody updates is worse than none.
 *
 * Reopening is first-class for the opposite reason: a fault that comes back
 * three weeks later is the same fault, and forcing a second ticket would lose
 * the history that makes it obvious the first repair did not hold.
 *
 * What is refused is going backwards — a resolved repair cannot become
 * untriaged — and resolving a closed one, which has to be reopened first.
 */
const NEXT_STATUS: Record<TicketStatus, readonly TicketStatus[]> = {
  OPEN: ["TRIAGED", "IN_PROGRESS", "RESOLVED", "CLOSED"],
  TRIAGED: ["IN_PROGRESS", "RESOLVED", "CLOSED"],
  IN_PROGRESS: ["RESOLVED", "CLOSED"],
  RESOLVED: ["IN_PROGRESS", "CLOSED"],
  CLOSED: ["IN_PROGRESS"],
};

const MAX_CENTS = 100_000_000;

/** The determination values that mean a shareholder owes something. */
const SHAREHOLDER_PAYS: readonly Responsibility[] = ["SHAREHOLDER", "SHARED"];

interface TicketRow {
  readonly id: string;
  readonly title: string;
  readonly unitId: string | null;
  readonly status: TicketStatus;
  readonly responsibility: Responsibility;
  readonly approvalRequestId: string | null;
}

/** Loads a ticket and confirms this member may see it at all. */
async function visibleTicket(
  tx: ScopedTx,
  ctx: BuildingContext,
  ticketId: string,
): Promise<{ ok: true; ticket: TicketRow } | { ok: false; failure: Failure }> {
  const ticket = await tx.ticket.findUnique({
    where: { id: ticketId },
    select: {
      id: true,
      title: true,
      unitId: true,
      status: true,
      responsibility: true,
      approvalRequestId: true,
    },
  });

  if (!ticket) {
    return { ok: false, failure: fail("not_found", "That repair could not be found.") };
  }

  const visible =
    can(ctx, "ticket.viewAll") ||
    ticket.unitId === null ||
    ctx.unitIds.includes(ticket.unitId);

  // Same message as a missing ticket. "It exists but is not yours" is itself a
  // disclosure in a building where everyone knows everyone.
  if (!visible) {
    return { ok: false, failure: fail("not_found", "That repair could not be found.") };
  }

  return { ok: true, ticket };
}

// --- Reporting -------------------------------------------------------------

export interface ReportTicketInput {
  readonly title: string;
  readonly detail: string;
  /** Null for the stoop, the boiler room, the front door — anything shared. */
  readonly unitId?: string | null;
  readonly area?: string | null;
  readonly priority?: TicketPriority;
}

export async function reportTicket(
  ctx: BuildingContext,
  input: ReportTicketInput,
): Promise<Result<{ ticketId: string }>> {
  assertCan(ctx, "ticket.create");

  const title = input.title.trim();
  const detail = input.detail.trim();

  if (title.length < 3) {
    return fail("invalid", "Say what's wrong, briefly.", {
      title: "“Radiator knocking overnight” is enough.",
    });
  }
  if (detail.length < 10) {
    return fail("invalid", "Describe it.", {
      detail:
        "Where it is, when it started, whether it's getting worse — enough for whoever turns up to bring the right tools.",
    });
  }

  // Reporting a problem in a neighbour's apartment is not a thing. Officers who
  // already see every unit may file on someone's behalf, which in a twelve-unit
  // building is the super typing up a phone call.
  if (
    input.unitId &&
    !ctx.unitIds.includes(input.unitId) &&
    !can(ctx, "ticket.viewAll")
  ) {
    return fail(
      "forbidden",
      "You can only report a repair for your own apartment, or for somewhere shared.",
    );
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    if (input.unitId) {
      const unit = await tx.unit.findUnique({
        where: { id: input.unitId },
        select: { id: true },
      });
      if (!unit) return fail("not_found", "That apartment isn't in this building.");
    }

    const ticket = await tx.ticket.create({
      data: {
        buildingId: ctx.building.id,
        unitId: input.unitId ?? null,
        area: input.area?.trim() || null,
        reportedById: ctx.membership.id,
        title,
        detail,
        priority: input.priority ?? "NORMAL",
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "ticket.report",
      entityType: "TICKET",
      entityId: ticket.id,
      after: { title, priority: input.priority ?? "NORMAL" },
      summary: `${title} reported`,
    });

    return ok({ ticketId: ticket.id });
  });
}

// --- Triage ----------------------------------------------------------------

export interface TriageTicketInput {
  /** A member — in these buildings, the super. */
  readonly assigneeId?: string | null;
  /** Or an outside contractor, who has no login and never will. */
  readonly vendorName?: string | null;
  readonly vendorPhone?: string | null;
  readonly priority?: TicketPriority;
}

/**
 * Hands a repair to whoever is going to look at it.
 *
 * Assignment is deliberately either/or in practice but not enforced as such —
 * "Sal will meet the plumber" is a real arrangement, and a system that refuses
 * to record it gets worked around in a notes field.
 */
export async function triageTicket(
  ctx: BuildingContext,
  ticketId: string,
  input: TriageTicketInput,
): Promise<Result<null>> {
  assertCan(ctx, "ticket.triage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleTicket(tx, ctx, ticketId);
    if (!found.ok) return found.failure;
    const { ticket } = found;

    if (input.assigneeId) {
      const member = await tx.membership.findUnique({
        where: { id: input.assigneeId },
        select: { id: true, status: true },
      });
      if (!member || member.status !== "ACTIVE") {
        return fail(
          "not_found",
          "That person isn't an active member of this building.",
        );
      }
    }

    // Triage is the first substantive act. It moves an untouched ticket along,
    // but never drags a resolved one backwards.
    const status: TicketStatus = ticket.status === "OPEN" ? "TRIAGED" : ticket.status;

    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.vendorName !== undefined
          ? { vendorName: input.vendorName?.trim() || null }
          : {}),
        ...(input.vendorPhone !== undefined
          ? { vendorPhone: input.vendorPhone?.trim() || null }
          : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        status,
        triagedAt: new Date(),
        triagedById: ctx.membership.id,
      },
    });

    await recordAudit(tx, ctx, {
      action: "ticket.triage",
      entityType: "TICKET",
      entityId: ticket.id,
      before: { status: ticket.status },
      after: {
        status,
        assigneeId: input.assigneeId ?? null,
        vendorName: input.vendorName ?? null,
        priority: input.priority ?? null,
      },
      summary: `${ticket.title} triaged`,
    });

    return ok(null);
  });
}

export async function setTicketStatus(
  ctx: BuildingContext,
  ticketId: string,
  status: TicketStatus,
): Promise<Result<null>> {
  assertCan(ctx, "ticket.triage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleTicket(tx, ctx, ticketId);
    if (!found.ok) return found.failure;
    const { ticket } = found;

    if (status === ticket.status) return ok(null);

    if (!NEXT_STATUS[ticket.status].includes(status)) {
      return fail(
        "conflict",
        `A repair that is ${ticket.status.toLowerCase().replaceAll("_", " ")} cannot be moved straight to ${status.toLowerCase().replaceAll("_", " ")}.`,
      );
    }

    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        status,
        // Reopening clears the resolution: a fault that came back was not
        // resolved, and leaving the timestamp would say it was.
        ...(status === "IN_PROGRESS" ? { resolvedAt: null, closedAt: null } : {}),
        ...(status === "CLOSED" ? { closedAt: new Date() } : {}),
      },
    });

    await recordAudit(tx, ctx, {
      action: "ticket.status",
      entityType: "TICKET",
      entityId: ticket.id,
      before: { status: ticket.status },
      after: { status },
      summary: `${ticket.title} — ${status.toLowerCase().replaceAll("_", " ")}`,
    });

    return ok(null);
  });
}

// --- Resolution ------------------------------------------------------------

export interface ResolveTicketInput {
  readonly note: string;
  readonly costCents?: number | null;
}

/**
 * Records that the repair is done, and what was actually done.
 *
 * The note is required. A ticket closed with no account of the work is a ticket
 * that teaches the next board nothing — and "replaced the flush valve, not the
 * whole tank" is exactly what tells them, two years later, whether this is the
 * same fault recurring or a new one.
 */
export async function resolveTicket(
  ctx: BuildingContext,
  ticketId: string,
  input: ResolveTicketInput,
): Promise<Result<null>> {
  assertCan(ctx, "ticket.triage");

  const note = input.note.trim();
  if (note.length < 5) {
    return fail("invalid", "Say what was done.", {
      note: "“Replaced the flush valve” — enough that the next person reading this knows what was fixed.",
    });
  }

  if (input.costCents != null) {
    if (!Number.isInteger(input.costCents) || input.costCents < 0) {
      return fail("invalid", "That cost could not be read.", {
        costCents: "Enter an amount like 350.00, or leave it blank.",
      });
    }
    if (input.costCents > MAX_CENTS) {
      return fail("invalid", "That cost looks like a typo.", {
        costCents: "Anything over $1,000,000 belongs in building work, not a repair.",
      });
    }
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleTicket(tx, ctx, ticketId);
    if (!found.ok) return found.failure;
    const { ticket } = found;

    if (
      !NEXT_STATUS[ticket.status].includes("RESOLVED") &&
      ticket.status !== "RESOLVED"
    ) {
      return fail(
        "conflict",
        `A repair that is ${ticket.status.toLowerCase().replaceAll("_", " ")} cannot be marked resolved.`,
      );
    }

    await tx.ticket.update({
      where: { id: ticket.id },
      data: {
        status: "RESOLVED",
        resolutionNote: note,
        costCents: input.costCents ?? null,
        resolvedAt: new Date(),
        resolvedById: ctx.membership.id,
      },
    });

    await recordAudit(tx, ctx, {
      action: "ticket.resolve",
      entityType: "TICKET",
      entityId: ticket.id,
      before: { status: ticket.status },
      after: { status: "RESOLVED", costCents: input.costCents ?? null },
      summary: `${ticket.title} resolved — ${note}`,
    });

    return ok(null);
  });
}

// --- The responsibility determination --------------------------------------

/**
 * Opens the question: who pays for this one?
 *
 * Anyone who can see the ticket may ask, including the shareholder whose
 * apartment it is — being able to make the board answer in writing is the point
 * of the feature from their side, not only from the board's.
 */
export async function openDetermination(
  ctx: BuildingContext,
  ticketId: string,
  input: { question?: string | null } = {},
): Promise<Result<{ approvalRequestId: string }>> {
  assertCan(ctx, "ticket.create");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleTicket(tx, ctx, ticketId);
    if (!found.ok) return found.failure;
    const { ticket } = found;

    if (ticket.approvalRequestId) {
      return fail(
        "conflict",
        "This repair already has a responsibility determination open or decided.",
      );
    }

    const approval = await tx.approvalRequest.create({
      data: {
        buildingId: ctx.building.id,
        kind: "TICKET_RESPONSIBILITY",
        status: "SUBMITTED",
        submittedById: ctx.membership.id,
        submittedAt: new Date(),
      },
      select: { id: true },
    });

    await tx.ticket.update({
      where: { id: ticket.id },
      data: { approvalRequestId: approval.id },
    });

    const question = input.question?.trim();
    if (question) {
      await tx.approvalComment.create({
        data: {
          buildingId: ctx.building.id,
          requestId: approval.id,
          authorId: ctx.membership.id,
          body: question,
          visibility: "SHARED",
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: "ticket.openDetermination",
      entityType: "TICKET",
      entityId: ticket.id,
      after: { approvalRequestId: approval.id },
      summary: `Who pays for ${ticket.title}? — put to the board`,
    });

    return ok({ approvalRequestId: approval.id });
  });
}

export interface DecideResponsibilityInput {
  readonly action: ApprovalAction;
  /** Required when approving: who actually pays. */
  readonly responsibility?: Responsibility;
  readonly note?: string | null;
  readonly conditions?: string | null;
}

/**
 * Moves the determination along, and records the answer.
 *
 * Every guard comes from the shared approval state machine, so the refusals a
 * board reads here are the same ones an alteration would give. What this adds is
 * that approving means naming who pays: an approved determination with no answer
 * on it would be a decision that decided nothing.
 *
 * There is deliberately no "deny". A repair always has someone responsible for
 * it, and a board that disagrees with a proposed answer records the answer it
 * does agree with. Denial would leave the question open while looking settled.
 */
export async function decideResponsibility(
  ctx: BuildingContext,
  ticketId: string,
  input: DecideResponsibilityInput,
): Promise<Result<{ status: string; responsibility: Responsibility }>> {
  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleTicket(tx, ctx, ticketId);
    if (!found.ok) return found.failure;
    const { ticket } = found;

    if (!ticket.approvalRequestId) {
      return fail(
        "conflict",
        "Nobody has put this repair to the board yet, so there is nothing to decide.",
      );
    }

    const approval = await tx.approvalRequest.findUniqueOrThrow({
      where: { id: ticket.approvalRequestId },
      select: { id: true, status: true, submittedById: true },
    });

    if (input.action === "deny") {
      return fail(
        "invalid",
        "A repair always has someone responsible for it. Record who pays rather than denying the question.",
      );
    }

    const capability = DECIDE_CAPABILITY["TICKET_RESPONSIBILITY"];
    const check = transition({
      status: approval.status,
      action: input.action,
      isSubmitter: approval.submittedById === ctx.membership.id,
      canDecide: capability ? can(ctx, capability) : false,
    });
    if (!check.ok) return fail("conflict", check.reason);

    const deciding =
      check.next === "APPROVED" || check.next === "APPROVED_WITH_CONDITIONS";

    if (deciding) {
      if (!input.responsibility || input.responsibility === "UNDETERMINED") {
        return fail("invalid", "Say who pays for this repair.", {
          responsibility:
            "The shareholder, the co-op, or shared. That answer is the determination.",
        });
      }
      if (input.responsibility !== "COOPERATIVE" && !ticket.unitId) {
        return fail(
          "invalid",
          "This repair isn't attached to an apartment, so it cannot be the shareholder's.",
          { responsibility: "Somewhere shared is the corporation's by definition." },
        );
      }
      if (check.next === "APPROVED_WITH_CONDITIONS" && !input.conditions?.trim()) {
        return fail("invalid", "Say what the conditions are.", {
          conditions:
            "The conditions are the operative part — a cost ceiling, a share of the bill, who arranges the work.",
        });
      }
    }

    await tx.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: check.next,
        ...(deciding
          ? {
              decidedAt: new Date(),
              decidedById: ctx.membership.id,
              decisionNote: input.note?.trim() || null,
              conditions: input.conditions?.trim() || null,
            }
          : {}),
        ...(check.next === "WITHDRAWN" ? { withdrawnAt: new Date() } : {}),
        ...(check.next === "UNDER_REVIEW" ? { assigneeId: ctx.membership.id } : {}),
      },
    });

    const responsibility =
      deciding && input.responsibility ? input.responsibility : ticket.responsibility;

    if (deciding) {
      await tx.ticket.update({
        where: { id: ticket.id },
        data: { responsibility },
      });
    }

    await recordAudit(tx, ctx, {
      action: `ticket.${input.action}`,
      entityType: "TICKET",
      entityId: ticket.id,
      before: { status: approval.status, responsibility: ticket.responsibility },
      after: { status: check.next, responsibility },
      summary: deciding
        ? `${ticket.title} — ${responsibility === "COOPERATIVE" ? "the co-op pays" : responsibility === "SHARED" ? "cost shared" : "the shareholder pays"}`
        : `${ticket.title} determination — ${check.next.toLowerCase().replaceAll("_", " ")}`,
    });

    return ok({ status: check.next, responsibility });
  });
}

export async function commentOnTicket(
  ctx: BuildingContext,
  ticketId: string,
  input: { body: string; boardOnly?: boolean },
): Promise<Result<{ commentId: string }>> {
  assertCan(ctx, "ticket.create");

  const body = input.body.trim();
  if (body.length === 0) return fail("invalid", "Write something first.");

  // The private thread is where the board discusses whether a neighbour is
  // about to be billed. A shareholder posting into it — or reading it — is a
  // leak no view-layer check would catch.
  if (input.boardOnly) assertCan(ctx, "ticket.decideResponsibility");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleTicket(tx, ctx, ticketId);
    if (!found.ok) return found.failure;
    const { ticket } = found;

    if (!ticket.approvalRequestId) {
      return fail(
        "conflict",
        "There's no determination thread on this repair yet. Put the question to the board first.",
      );
    }

    const comment = await tx.approvalComment.create({
      data: {
        buildingId: ctx.building.id,
        requestId: ticket.approvalRequestId,
        authorId: ctx.membership.id,
        body,
        visibility: input.boardOnly ? "BOARD_ONLY" : "SHARED",
      },
      select: { id: true },
    });

    return ok({ commentId: comment.id });
  });
}

// --- The bill --------------------------------------------------------------

export interface ChargeTicketInput {
  readonly amountCents: number;
  readonly dueOn: PlainDate;
  readonly memo?: string | null;
}

/**
 * Bills the apartment for a repair the board determined it is responsible for.
 *
 * This is the gate the module exists for. Everything upstream — the photos, the
 * triage, the comment thread — is a record of a problem. This turns that record
 * into money a neighbour owes, and it will not do so until an officer has
 * decided, in writing and under their own name, that the neighbour is the one
 * who pays.
 *
 * Once only. A correction is a reversing entry on the ledger, which leaves both
 * the error and the fix where a shareholder disputing the bill can see them.
 */
export async function chargeTicketToUnit(
  ctx: BuildingContext,
  ticketId: string,
  input: ChargeTicketInput,
): Promise<Result<{ chargeId: string }>> {
  assertCan(ctx, "arrears.postCharge");

  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return fail("invalid", "An amount has to be more than nothing.", {
      amountCents: "Enter an amount greater than zero.",
    });
  }
  if (input.amountCents > MAX_CENTS) {
    return fail("invalid", "That amount looks like a typo.", {
      amountCents: "Anything over $1,000,000 belongs in building work, not a repair.",
    });
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleTicket(tx, ctx, ticketId);
    if (!found.ok) return found.failure;
    const { ticket } = found;

    if (!ticket.unitId) {
      return fail(
        "conflict",
        "This repair isn't attached to an apartment, so there is nobody to bill.",
      );
    }

    if (ticket.responsibility === "UNDETERMINED") {
      return fail(
        "conflict",
        "The board hasn't determined who pays for this repair. A shareholder cannot be billed for one until it has.",
      );
    }
    if (!SHAREHOLDER_PAYS.includes(ticket.responsibility)) {
      return fail(
        "conflict",
        "The board determined this repair is the corporation's, so there is nothing to bill the apartment for.",
      );
    }

    const existing = await tx.charge.findMany({
      where: { ticketId: ticket.id },
      select: { id: true, reversesChargeId: true },
    });
    const reversed = new Set(
      existing.map((c) => c.reversesChargeId).filter((id): id is string => Boolean(id)),
    );
    const live = existing.filter((c) => !c.reversesChargeId && !reversed.has(c.id));
    if (live.length > 0) {
      return fail(
        "conflict",
        "This repair has already been billed. Reverse that charge on the apartment's ledger if it was wrong.",
      );
    }

    const charge = await tx.charge.create({
      data: {
        buildingId: ctx.building.id,
        unitId: ticket.unitId,
        kind: "OTHER",
        amountCents: input.amountCents,
        dueOn: toDbDate(input.dueOn),
        postedOn: toDbDate(input.dueOn),
        memo: input.memo?.trim() || `Repair: ${ticket.title}`,
        ticketId: ticket.id,
        createdById: ctx.membership.id,
      },
      select: { id: true, unit: { select: { label: true } } },
    });

    await recordAudit(tx, ctx, {
      action: "ticket.charge",
      entityType: "TICKET",
      entityId: ticket.id,
      after: {
        chargeId: charge.id,
        amountCents: input.amountCents,
        responsibility: ticket.responsibility,
      },
      summary: `${charge.unit.label} billed for ${ticket.title}`,
    });

    return ok({ chargeId: charge.id });
  });
}
