import { assertCan, can } from "~/lib/auth/capabilities";
import {
  DECIDE_CAPABILITY,
  transition,
  type ApprovalAction,
} from "~/lib/primitives/approvals";
import { reminderDates } from "~/lib/primitives/obligations/recurrence";
import { termsOverlap } from "~/lib/primitives/sublets";
import { fail, ok, type Failure, type Result } from "~/lib/result";
import {
  addDays,
  compareDates,
  toDbDate,
  today,
  toPlainDate,
  type PlainDate,
} from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx, type ScopedTx } from "../tx";
import { recordAudit } from "./audit";
import { capWithin, isActiveOn, isApproved } from "./sublets";

/**
 * Applying to sublet, and the cap that decides whether the board may say yes.
 *
 * The rule this module exists for is different in kind from the other two gates
 * in Co-operator. An assessment needs a vote and a repair bill needs a
 * determination: both are *authorisations*, questions about who decided. The
 * sublet cap is a **building-wide invariant** — "not more than twenty per cent
 * of the apartments may be sublet at once" — and it is checked against a live
 * count at the moment of approval, not at the moment of application.
 *
 * That matters because the count moves underneath an application. Two
 * shareholders apply in March, the board approves the first in April, and by
 * the time it reaches the second the building is at its cap. Checking on the
 * way in would have let both through.
 *
 * The stakes are not only the house rules. A co-op over its cap can lose
 * lending eligibility for every shareholder trying to sell, because secondary
 * lenders limit how much of a building may be non-owner-occupied. It is exactly
 * the number a volunteer board loses across a turnover.
 *
 * Terms expire, so approval also puts the end date on the compliance calendar.
 * A sublet nobody notices running out is a subtenant in occupation without
 * permission, which is the building's problem rather than the shareholder's.
 */

/** How far ahead of a term ending to start reminding, in days. */
const EXPIRY_REMINDER_OFFSETS = [60, 30, 7];

/** Longer than this is not a sublet, it is an assignment. */
const MAX_TERM_DAYS = 365 * 3;

const MAX_CENTS = 100_000_000;

interface SubletRow {
  readonly id: string;
  readonly unitId: string;
  readonly subtenantName: string;
  readonly termStart: Date;
  readonly termEnd: Date;
  readonly endedOn: Date | null;
  readonly feeCents: number;
  readonly obligationId: string | null;
  readonly approvalRequestId: string | null;
  readonly unit: { label: string };
}

async function visibleSublet(
  tx: ScopedTx,
  ctx: BuildingContext,
  subletId: string,
): Promise<{ ok: true; sublet: SubletRow } | { ok: false; failure: Failure }> {
  const sublet = await tx.subletRegistration.findUnique({
    where: { id: subletId },
    select: {
      id: true,
      unitId: true,
      subtenantName: true,
      termStart: true,
      termEnd: true,
      endedOn: true,
      feeCents: true,
      obligationId: true,
      approvalRequestId: true,
      unit: { select: { label: true } },
    },
  });

  if (!sublet) {
    return {
      ok: false,
      failure: fail("not_found", "That sublet could not be found."),
    };
  }
  if (!can(ctx, "sublet.viewAll") && !ctx.unitIds.includes(sublet.unitId)) {
    return {
      ok: false,
      failure: fail("not_found", "That sublet could not be found."),
    };
  }

  return { ok: true, sublet };
}

function checkTerm(start: PlainDate, end: PlainDate): Failure | null {
  if (compareDates(end, start) <= 0) {
    return fail("invalid", "The term ends before it begins.", {
      termEnd: "A sublet has to run for at least a day.",
    });
  }

  const days = Math.round(
    (new Date(`${end}T00:00:00Z`).getTime() -
      new Date(`${start}T00:00:00Z`).getTime()) /
      86_400_000,
  );
  if (days > MAX_TERM_DAYS) {
    return fail("invalid", "That term is longer than a sublet.", {
      termEnd:
        "Anything past three years is an assignment of the lease, which is a different application.",
    });
  }

  return null;
}

// --- Applying --------------------------------------------------------------

export interface ApplyToSubletInput {
  readonly unitId: string;
  readonly subtenantName: string;
  readonly subtenantContact?: string | null;
  readonly termStart: PlainDate;
  readonly termEnd: PlainDate;
  readonly feeCents?: number;
  readonly note?: string | null;
  /** Set when this application follows an existing sublet. */
  readonly renewedFromId?: string | null;
}

/**
 * A shareholder applies to sublet their apartment.
 *
 * The cap is *not* enforced here. Being at the cap today does not mean the
 * board should refuse to look at an application for a term starting in six
 * months, by which time somebody's term will have run out. What is refused is
 * the thing that is wrong regardless of timing: an apartment applying for a
 * term that overlaps one it already has.
 */
export async function applyToSublet(
  ctx: BuildingContext,
  input: ApplyToSubletInput,
): Promise<Result<{ subletId: string }>> {
  assertCan(ctx, "sublet.submit");

  const name = input.subtenantName.trim();
  if (name.length < 2) {
    return fail("invalid", "Who is moving in?", {
      subtenantName: "The subtenant's name, as it will appear on the sublease.",
    });
  }

  const badTerm = checkTerm(input.termStart, input.termEnd);
  if (badTerm) return badTerm;

  if (input.feeCents != null) {
    if (!Number.isInteger(input.feeCents) || input.feeCents < 0) {
      return fail("invalid", "That fee could not be read.", {
        feeCents: "Enter an amount like 1,200.00, or leave it blank.",
      });
    }
    if (input.feeCents > MAX_CENTS) {
      return fail("invalid", "That fee looks like a typo.", { feeCents: "Check it." });
    }
  }

  // Applying for a neighbour's apartment is not a thing. Officers who already
  // see the whole register may file on someone's behalf.
  const ownsUnit = ctx.unitIds.includes(input.unitId);
  if (!ownsUnit && !can(ctx, "sublet.viewAll")) {
    return fail("forbidden", "You can only apply to sublet your own apartment.");
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const unit = await tx.unit.findUnique({
      where: { id: input.unitId },
      select: { id: true, label: true },
    });
    if (!unit) return fail("not_found", "That apartment isn't in this building.");

    // One apartment, one sublet at a time. Anything not refused or withdrawn
    // still counts — a pending application for overlapping dates is a mistake
    // whether or not it is eventually approved.
    const existing = await tx.subletRegistration.findMany({
      where: { unitId: unit.id },
      select: {
        id: true,
        termStart: true,
        termEnd: true,
        endedOn: true,
        approval: { select: { status: true } },
      },
    });

    const clash = existing.find((other) => {
      const dead =
        other.approval?.status === "DENIED" || other.approval?.status === "WITHDRAWN";
      if (dead) return false;
      return termsOverlap(
        { start: input.termStart, end: input.termEnd },
        {
          start: toPlainDate(other.termStart),
          end: toPlainDate(other.termEnd),
          endedOn: other.endedOn ? toPlainDate(other.endedOn) : null,
        },
      );
    });

    if (clash) {
      return fail(
        "conflict",
        `${unit.label} already has a sublet covering those dates. End that one first, or apply to renew it.`,
      );
    }

    const approval = await tx.approvalRequest.create({
      data: {
        buildingId: ctx.building.id,
        kind: "SUBLET",
        status: "SUBMITTED",
        submittedById: ctx.membership.id,
        submittedAt: new Date(),
      },
      select: { id: true },
    });

    const sublet = await tx.subletRegistration.create({
      data: {
        buildingId: ctx.building.id,
        unitId: unit.id,
        approvalRequestId: approval.id,
        subtenantName: name,
        subtenantContact: input.subtenantContact?.trim() || null,
        termStart: toDbDate(input.termStart),
        termEnd: toDbDate(input.termEnd),
        feeCents: input.feeCents ?? 0,
        renewedFromId: input.renewedFromId ?? null,
        createdById: ctx.membership.id,
      },
      select: { id: true },
    });

    const note = input.note?.trim();
    if (note) {
      await tx.approvalComment.create({
        data: {
          buildingId: ctx.building.id,
          requestId: approval.id,
          authorId: ctx.membership.id,
          body: note,
          visibility: "SHARED",
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: "sublet.apply",
      entityType: "SUBLET_REGISTRATION",
      entityId: sublet.id,
      after: {
        unit: unit.label,
        subtenantName: name,
        termStart: input.termStart,
        termEnd: input.termEnd,
      },
      summary: `${unit.label} applied to sublet to ${name} until ${input.termEnd}`,
    });

    return ok({ subletId: sublet.id });
  });
}

// --- Deciding --------------------------------------------------------------

export interface ActOnSubletInput {
  readonly action: ApprovalAction;
  readonly note?: string | null;
  readonly conditions?: string | null;
}

/**
 * Moves a sublet application through the approval workflow.
 *
 * Approving is the one action that checks the cap, and it checks it as of the
 * term's start date rather than today: the question is whether the building
 * will be over its limit when this subtenant actually moves in.
 */
export async function actOnSublet(
  ctx: BuildingContext,
  subletId: string,
  input: ActOnSubletInput,
): Promise<Result<{ status: string }>> {
  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleSublet(tx, ctx, subletId);
    if (!found.ok) return found.failure;
    const { sublet } = found;

    if (!sublet.approvalRequestId) {
      return fail("conflict", "That sublet has no application behind it.");
    }

    const approval = await tx.approvalRequest.findUniqueOrThrow({
      where: { id: sublet.approvalRequestId },
      select: { id: true, status: true, submittedById: true },
    });

    const capability = DECIDE_CAPABILITY["SUBLET"];
    const check = transition({
      status: approval.status,
      action: input.action,
      isSubmitter: approval.submittedById === ctx.membership.id,
      canDecide: capability ? can(ctx, capability) : false,
    });
    if (!check.ok) return fail("conflict", check.reason);

    const approving =
      check.next === "APPROVED" || check.next === "APPROVED_WITH_CONDITIONS";

    if (check.next === "APPROVED_WITH_CONDITIONS" && !input.conditions?.trim()) {
      return fail("invalid", "Say what the conditions are.", {
        conditions:
          "The conditions are the operative part — a shorter term, a larger fee, the subtenant's insurance.",
      });
    }

    if (approving) {
      // The invariant. Counted as of the day the subtenant moves in, because
      // that is when the building would actually be over its limit.
      const startsOn = toPlainDate(sublet.termStart);
      const reading = await capWithin(tx, ctx, startsOn);

      if (!reading.roomForOneMore) {
        return fail(
          "conflict",
          `The lease allows ${reading.allowed} of ${reading.totalUnits} apartments to be sublet at once, and ${reading.current} already ${reading.current === 1 ? "is" : "are"} on ${startsOn}. Approving this one would put the building over its cap.`,
        );
      }
    }

    await tx.approvalRequest.update({
      where: { id: approval.id },
      data: {
        status: check.next,
        ...(approving || check.next === "DENIED"
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

    if (approving && !sublet.obligationId) {
      await scheduleExpiry(tx, ctx, sublet);
    }

    await recordAudit(tx, ctx, {
      action: `sublet.${input.action}`,
      entityType: "SUBLET_REGISTRATION",
      entityId: sublet.id,
      before: { status: approval.status },
      after: { status: check.next },
      summary: `${sublet.unit.label} sublet to ${sublet.subtenantName} — ${check.next.toLowerCase().replaceAll("_", " ")}`,
    });

    return ok({ status: check.next });
  });
}

/**
 * Puts the term's end on the compliance calendar.
 *
 * The same machinery a certificate of insurance uses, for the same reason: a
 * date filed and forgotten is worth nothing, and being told sixty days out is
 * the product. A sublet that quietly runs past its term is a subtenant in
 * occupation without permission, and that is the corporation's problem.
 */
async function scheduleExpiry(
  tx: ScopedTx,
  ctx: BuildingContext,
  sublet: SubletRow,
): Promise<void> {
  const endsOn = toPlainDate(sublet.termEnd);
  const now = today(ctx.building.timezone);

  const obligation = await tx.obligation.create({
    data: {
      buildingId: ctx.building.id,
      kind: "SUBLET_EXPIRY",
      title: `${sublet.unit.label} sublet ends`,
      detail: `${sublet.subtenantName} is in occupation until this date. Renew it or take the apartment back — an expired sublet running on is the corporation's problem, not the shareholder's.`,
      dueOn: toDbDate(endsOn),
      recurrenceType: "NONE",
      reminderOffsets: EXPIRY_REMINDER_OFFSETS,
      subjectType: "SUBLET_REGISTRATION",
      subjectId: sublet.id,
      state: "OPEN",
    },
    select: { id: true },
  });

  for (const reminder of reminderDates(endsOn, EXPIRY_REMINDER_OFFSETS, now)) {
    await tx.obligationReminder.create({
      data: {
        buildingId: ctx.building.id,
        obligationId: obligation.id,
        offsetDays: reminder.offsetDays,
        scheduledFor: toDbDate(reminder.scheduledFor),
      },
    });
  }

  await tx.subletRegistration.update({
    where: { id: sublet.id },
    data: { obligationId: obligation.id },
  });
}

export async function commentOnSublet(
  ctx: BuildingContext,
  subletId: string,
  input: { body: string; boardOnly?: boolean },
): Promise<Result<{ commentId: string }>> {
  assertCan(ctx, "sublet.submit");

  const body = input.body.trim();
  if (body.length === 0) return fail("invalid", "Write something first.");
  if (input.boardOnly) assertCan(ctx, "sublet.decide");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleSublet(tx, ctx, subletId);
    if (!found.ok) return found.failure;
    if (!found.sublet.approvalRequestId) {
      return fail("conflict", "That sublet has no application behind it.");
    }

    const comment = await tx.approvalComment.create({
      data: {
        buildingId: ctx.building.id,
        requestId: found.sublet.approvalRequestId,
        authorId: ctx.membership.id,
        body,
        visibility: input.boardOnly ? "BOARD_ONLY" : "SHARED",
      },
      select: { id: true },
    });

    return ok({ commentId: comment.id });
  });
}

// --- Ending early ----------------------------------------------------------

/**
 * Records that a subtenant left before the term ran out.
 *
 * This frees a slot under the cap, which is why it has to be recordable rather
 * than left to expire on paper: the neighbour whose application was refused
 * last month may now be approvable, and nobody will think to check unless the
 * register says the apartment is free.
 */
export async function endSublet(
  ctx: BuildingContext,
  subletId: string,
  input: { endedOn: PlainDate; reason?: string | null },
): Promise<Result<null>> {
  assertCan(ctx, "sublet.decide");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleSublet(tx, ctx, subletId);
    if (!found.ok) return found.failure;
    const { sublet } = found;

    if (sublet.endedOn) {
      return fail("conflict", "That sublet is already recorded as ended.");
    }

    const start = toPlainDate(sublet.termStart);
    const end = toPlainDate(sublet.termEnd);

    if (compareDates(input.endedOn, start) < 0) {
      return fail("invalid", "That is before the term began.", {
        endedOn: `The term started on ${start}.`,
      });
    }
    if (compareDates(input.endedOn, end) > 0) {
      return fail("invalid", "That is after the term was due to end anyway.", {
        endedOn: `The term ran to ${end}, so there is nothing to cut short.`,
      });
    }

    await tx.subletRegistration.update({
      where: { id: sublet.id },
      data: {
        endedOn: toDbDate(input.endedOn),
        endedReason: input.reason?.trim() || null,
        endedById: ctx.membership.id,
      },
    });

    // The expiry reminder is about a date that is no longer coming.
    if (sublet.obligationId) {
      await tx.obligation.update({
        where: { id: sublet.obligationId },
        data: {
          state: "COMPLETED",
          completedOn: toDbDate(input.endedOn),
          completedById: ctx.membership.id,
          completionNote: "The sublet ended early.",
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: "sublet.end",
      entityType: "SUBLET_REGISTRATION",
      entityId: sublet.id,
      after: { endedOn: input.endedOn, reason: input.reason ?? null },
      summary: `${sublet.unit.label} sublet ended early on ${input.endedOn}`,
    });

    return ok(null);
  });
}

// --- The fee ---------------------------------------------------------------

/**
 * Posts the sublet fee to the apartment's ledger.
 *
 * A separate, deliberate act by the treasurer, like every other way money
 * reaches a ledger in this system. Refused before approval — billing a
 * shareholder for permission they have not been given is the wrong order — and
 * refused twice, because a correction is a reversing entry.
 */
export async function postSubletFee(
  ctx: BuildingContext,
  subletId: string,
  input: { amountCents?: number; dueOn: PlainDate; memo?: string | null },
): Promise<Result<{ chargeId: string }>> {
  assertCan(ctx, "arrears.postCharge");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await visibleSublet(tx, ctx, subletId);
    if (!found.ok) return found.failure;
    const { sublet } = found;

    const approval = sublet.approvalRequestId
      ? await tx.approvalRequest.findUnique({
          where: { id: sublet.approvalRequestId },
          select: { status: true },
        })
      : null;

    if (!isApproved({ approval })) {
      return fail(
        "conflict",
        "The board hasn't approved this sublet, so there is no fee to charge for it yet.",
      );
    }

    const amountCents = input.amountCents ?? sublet.feeCents;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return fail("invalid", "An amount has to be more than nothing.", {
        amountCents: "Enter the fee the house rules set for a sublet.",
      });
    }
    if (amountCents > MAX_CENTS) {
      return fail("invalid", "That amount looks like a typo.", {
        amountCents: "Check the fee against the house rules.",
      });
    }

    const existing = await tx.charge.findMany({
      where: { subletId: sublet.id },
      select: { id: true, reversesChargeId: true },
    });
    const reversed = new Set(
      existing.map((c) => c.reversesChargeId).filter((id): id is string => Boolean(id)),
    );
    const live = existing.filter((c) => !c.reversesChargeId && !reversed.has(c.id));
    if (live.length > 0) {
      return fail(
        "conflict",
        "The fee for this sublet has already been charged. Reverse it on the apartment's ledger if it was wrong.",
      );
    }

    const charge = await tx.charge.create({
      data: {
        buildingId: ctx.building.id,
        unitId: sublet.unitId,
        kind: "SUBLET_FEE",
        amountCents,
        dueOn: toDbDate(input.dueOn),
        postedOn: toDbDate(input.dueOn),
        memo: input.memo?.trim() || `Sublet fee — ${sublet.subtenantName}`,
        subletId: sublet.id,
        createdById: ctx.membership.id,
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "sublet.postFee",
      entityType: "SUBLET_REGISTRATION",
      entityId: sublet.id,
      after: { chargeId: charge.id, amountCents },
      summary: `${sublet.unit.label} charged the sublet fee`,
    });

    return ok({ chargeId: charge.id });
  });
}

// --- Renewal ---------------------------------------------------------------

/**
 * Applies to renew, as a new application rather than an extended term.
 *
 * Most proprietary leases make a renewal a fresh application, and they are
 * right to: the cap has to be re-checked, and the board has to be able to say
 * no the second time. Rewriting the end date in place would lose the fact that
 * they said yes twice — and would slip an extra year past the cap check.
 */
export async function renewSublet(
  ctx: BuildingContext,
  subletId: string,
  input: { termStart?: PlainDate; termEnd: PlainDate; feeCents?: number },
): Promise<Result<{ subletId: string }>> {
  assertCan(ctx, "sublet.submit");

  const found = await withBuildingTx(ctx.building.id, (tx) =>
    visibleSublet(tx, ctx, subletId),
  );
  if (!found.ok) return found.failure;
  const { sublet } = found;

  const ending = toPlainDate(sublet.termEnd);

  // The renewal picks up the day after the current term ends, unless the
  // applicant says otherwise — starting it on the same day would overlap, and
  // the application would refuse itself.
  return applyToSublet(ctx, {
    unitId: sublet.unitId,
    subtenantName: sublet.subtenantName,
    subtenantContact: null,
    termStart: input.termStart ?? addDays(ending, 1),
    termEnd: input.termEnd,
    feeCents: input.feeCents ?? sublet.feeCents,
    renewedFromId: sublet.id,
    note: `Renewal of the sublet to ${sublet.subtenantName} that ends ${ending}.`,
  });
}

/** Re-exported so callers do not have to reach into two modules for one answer. */
export { isActiveOn };
