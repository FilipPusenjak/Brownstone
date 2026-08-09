import { assertCan, can } from "~/lib/auth/capabilities";
import { fail, ok, type Result } from "~/lib/result";
import {
  DECIDE_CAPABILITY,
  transition,
  type ApprovalAction,
} from "~/lib/primitives/approvals";
import { reminderDates } from "~/lib/primitives/obligations/recurrence";
import { plainDate, toDbDate, today, type PlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { recordAudit } from "./audit";

/**
 * Alterations, their approvals, and the certificates of insurance attached to
 * them.
 *
 * The state machine lives in `src/lib/primitives/approvals.ts` and is shared
 * with sublets and ticket responsibility determinations. Nothing here reimplements
 * "can this be approved" — it asks, and records what the answer was.
 *
 * The rule this module exists to enforce: a decision is a record, not a
 * setting. Once made it cannot be edited, only superseded by a new request.
 * Boards change their minds, and when they do the minutes and the system have
 * to agree about what was approved and when.
 */

/** Reminder offsets for a certificate about to lapse, in days before expiry. */
const COI_REMINDER_OFFSETS = [45, 14, 3];

export interface SubmitAlterationInput {
  unitId: string;
  title: string;
  scope: string;
  contractorName?: string | null;
  contractorLicense?: string | null;
  contractorPhone?: string | null;
  wetOverDry?: boolean;
  affectsStructure?: boolean;
  affectsRiser?: boolean;
  requiresDobPermit?: boolean;
  dobJobNumber?: string | null;
  plannedStart?: string | null;
  plannedEnd?: string | null;
  /** False keeps it a draft the shareholder can still edit. */
  submit?: boolean;
}

export async function submitAlteration(
  ctx: BuildingContext,
  input: SubmitAlterationInput,
): Promise<Result<{ alterationId: string }>> {
  assertCan(ctx, "alteration.submit");

  const title = input.title.trim();
  const scope = input.scope.trim();

  if (title.length < 3) {
    return fail("invalid", "Give the work a short name.", {
      title: "For example: Kitchen renovation.",
    });
  }
  if (scope.length < 20) {
    return fail("invalid", "Describe the work.", {
      scope:
        "The board needs enough to decide. What is being changed, and does it touch plumbing, walls or the riser?",
    });
  }

  // A shareholder files for their own apartment. Officers who can see every
  // unit may file on someone's behalf — in a twelve-unit building the
  // secretary routinely types things up for a neighbour who does not use
  // email.
  const ownsUnit = ctx.unitIds.includes(input.unitId);
  if (!ownsUnit && !can(ctx, "alteration.viewAll")) {
    return fail("forbidden", "You can only file an alteration for your own apartment.");
  }

  let plannedStart: PlainDate | null = null;
  let plannedEnd: PlainDate | null = null;
  try {
    plannedStart = input.plannedStart ? plainDate(input.plannedStart) : null;
    plannedEnd = input.plannedEnd ? plainDate(input.plannedEnd) : null;
  } catch {
    return fail("invalid", "Enter the dates as calendar dates.", {
      plannedStart: "Use the date picker, or type it as YYYY-MM-DD.",
    });
  }

  if (plannedStart && plannedEnd && plannedEnd < plannedStart) {
    return fail("invalid", "The end date is before the start date.", {
      plannedEnd: "Work cannot finish before it begins.",
    });
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const unit = await tx.unit.findUnique({
      where: { id: input.unitId },
      select: { id: true, label: true },
    });
    if (!unit) return fail("not_found", "That apartment isn't in this building.");

    const approval = await tx.approvalRequest.create({
      data: {
        buildingId: ctx.building.id,
        kind: "ALTERATION",
        status: input.submit === false ? "DRAFT" : "SUBMITTED",
        submittedById: ctx.membership.id,
        submittedAt: input.submit === false ? null : new Date(),
      },
      select: { id: true },
    });

    const alteration = await tx.alterationRequest.create({
      data: {
        buildingId: ctx.building.id,
        unitId: unit.id,
        approvalRequestId: approval.id,
        title,
        scope,
        contractorName: input.contractorName?.trim() || null,
        contractorLicense: input.contractorLicense?.trim() || null,
        contractorPhone: input.contractorPhone?.trim() || null,
        wetOverDry: input.wetOverDry ?? false,
        affectsStructure: input.affectsStructure ?? false,
        affectsRiser: input.affectsRiser ?? false,
        requiresDobPermit: input.requiresDobPermit ?? false,
        dobJobNumber: input.dobJobNumber?.trim() || null,
        plannedStart: plannedStart ? toDbDate(plannedStart) : null,
        plannedEnd: plannedEnd ? toDbDate(plannedEnd) : null,
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "alteration.submit",
      entityType: "ALTERATION_REQUEST",
      entityId: alteration.id,
      after: { title, unit: unit.label },
      summary: `${title} filed for ${unit.label}`,
    });

    return ok({ alterationId: alteration.id });
  });
}

/**
 * Moves an alteration through its lifecycle.
 *
 * Every guard comes from the shared state machine, so the reasons a board sees
 * are the same ones a sublet or a ticket determination would give.
 */
export async function actOnAlteration(
  ctx: BuildingContext,
  input: {
    alterationId: string;
    action: ApprovalAction;
    note?: string | null;
    conditions?: string | null;
  },
): Promise<Result<{ status: string }>> {
  return withBuildingTx(ctx.building.id, async (tx) => {
    const alteration = await tx.alterationRequest.findUnique({
      where: { id: input.alterationId },
      select: {
        id: true,
        title: true,
        unitId: true,
        approval: { select: { id: true, status: true, submittedById: true } },
      },
    });
    if (!alteration) return fail("not_found", "That request could not be found.");

    const capability = DECIDE_CAPABILITY["ALTERATION"];
    const check = transition({
      status: alteration.approval.status,
      action: input.action,
      isSubmitter: alteration.approval.submittedById === ctx.membership.id,
      canDecide: capability ? can(ctx, capability) : false,
    });

    if (!check.ok) return fail("conflict", check.reason);

    const decided = [
      "APPROVED",
      "APPROVED_WITH_CONDITIONS",
      "DENIED",
    ].includes(check.next);

    if (input.action === "approveWithConditions" && !input.conditions?.trim()) {
      return fail("invalid", "Say what the conditions are.", {
        conditions:
          "The conditions are the operative part of the decision — work hours, insurance, whatever the board is requiring.",
      });
    }

    await tx.approvalRequest.update({
      where: { id: alteration.approval.id },
      data: {
        status: check.next,
        ...(decided
          ? {
              decidedAt: new Date(),
              decidedById: ctx.membership.id,
              decisionNote: input.note?.trim() || null,
              conditions: input.conditions?.trim() || null,
            }
          : {}),
        ...(check.next === "WITHDRAWN" ? { withdrawnAt: new Date() } : {}),
        ...(check.next === "SUBMITTED" ? { submittedAt: new Date() } : {}),
        ...(check.next === "UNDER_REVIEW" ? { assigneeId: ctx.membership.id } : {}),
      },
    });

    await recordAudit(tx, ctx, {
      action: `alteration.${input.action}`,
      entityType: "ALTERATION_REQUEST",
      entityId: alteration.id,
      before: { status: alteration.approval.status },
      after: { status: check.next, conditions: input.conditions ?? null },
      summary: `${alteration.title} — ${check.next.toLowerCase().replaceAll("_", " ")}`,
    });

    return ok({ status: check.next });
  });
}

export async function commentOnAlteration(
  ctx: BuildingContext,
  input: { alterationId: string; body: string; boardOnly?: boolean },
): Promise<Result<{ commentId: string }>> {
  assertCan(ctx, "alteration.comment");

  const body = input.body.trim();
  if (body.length === 0) return fail("invalid", "Write something first.");

  // Board-only is its own capability. A shareholder posting into the private
  // thread — or reading it — would be a leak that no view-layer check catches.
  if (input.boardOnly) assertCan(ctx, "alteration.commentInternal");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const alteration = await tx.alterationRequest.findUnique({
      where: { id: input.alterationId },
      select: { id: true, unitId: true, approvalRequestId: true, title: true },
    });
    if (!alteration) return fail("not_found", "That request could not be found.");

    const maySee =
      can(ctx, "alteration.viewAll") || ctx.unitIds.includes(alteration.unitId);
    if (!maySee) return fail("forbidden", "You don't have access to that request.");

    const comment = await tx.approvalComment.create({
      data: {
        buildingId: ctx.building.id,
        requestId: alteration.approvalRequestId,
        authorId: ctx.membership.id,
        body,
        visibility: input.boardOnly ? "BOARD_ONLY" : "SHARED",
      },
      select: { id: true },
    });

    return ok({ commentId: comment.id });
  });
}

export interface RecordCoiInput {
  holderKind: "SHAREHOLDER" | "CONTRACTOR" | "MOVER" | "VENDOR";
  holderName: string;
  carrier: string;
  policyNumber: string;
  coverageCents?: number | null;
  effectiveOn: string;
  expiresOn: string;
  unitId?: string | null;
  alterationRequestId?: string | null;
  documentId?: string | null;
  additionalInsuredVerified?: boolean;
  note?: string | null;
}

/**
 * Records a certificate of insurance and puts its expiry on the calendar.
 *
 * The expiry obligation is the entire point. A certificate filed and forgotten
 * is worth nothing; being told forty-five days before it lapses is the product.
 * So it goes on the same calendar as everything else rather than into a
 * separate notion of "alerts" nobody checks.
 */
export async function recordCertificate(
  ctx: BuildingContext,
  input: RecordCoiInput,
): Promise<Result<{ certificateId: string; obligationId: string }>> {
  assertCan(ctx, "coi.manage");

  const holderName = input.holderName.trim();
  if (holderName.length < 2) {
    return fail("invalid", "Who is insured?", {
      holderName: "The name on the certificate — the contractor, the mover, the shareholder.",
    });
  }

  let effectiveOn: PlainDate;
  let expiresOn: PlainDate;
  try {
    effectiveOn = plainDate(input.effectiveOn);
    expiresOn = plainDate(input.expiresOn);
  } catch {
    return fail("invalid", "Enter the dates as calendar dates.", {
      expiresOn: "Use the date picker, or type it as YYYY-MM-DD.",
    });
  }

  if (expiresOn <= effectiveOn) {
    return fail("invalid", "The certificate expires before it takes effect.", {
      expiresOn: "Check the dates on the certificate.",
    });
  }

  const now = today(ctx.building.timezone);

  return withBuildingTx(ctx.building.id, async (tx) => {
    if (input.unitId) {
      const unit = await tx.unit.findUnique({
        where: { id: input.unitId },
        select: { id: true },
      });
      if (!unit) return fail("not_found", "That apartment isn't in this building.");
    }

    const certificate = await tx.certificateOfInsurance.create({
      data: {
        buildingId: ctx.building.id,
        holderKind: input.holderKind,
        holderName,
        carrier: input.carrier.trim(),
        policyNumber: input.policyNumber.trim(),
        coverageCents: input.coverageCents ?? null,
        effectiveOn: toDbDate(effectiveOn),
        expiresOn: toDbDate(expiresOn),
        unitId: input.unitId ?? null,
        alterationRequestId: input.alterationRequestId ?? null,
        documentId: input.documentId ?? null,
        additionalInsuredVerified: input.additionalInsuredVerified ?? false,
        ...(input.additionalInsuredVerified
          ? { verifiedById: ctx.membership.id, verifiedAt: new Date() }
          : {}),
        note: input.note?.trim() || null,
      },
      select: { id: true },
    });

    const obligation = await tx.obligation.create({
      data: {
        buildingId: ctx.building.id,
        kind: "COI_EXPIRY",
        title: `${holderName} insurance expires`,
        detail: `${input.carrier.trim()} policy ${input.policyNumber.trim()}. Ask for a renewal certificate before this date.`,
        dueOn: toDbDate(expiresOn),
        recurrenceType: "NONE",
        reminderOffsets: COI_REMINDER_OFFSETS,
        subjectType: "CERTIFICATE_OF_INSURANCE",
        subjectId: certificate.id,
        state: "OPEN",
      },
      select: { id: true },
    });

    for (const reminder of reminderDates(expiresOn, COI_REMINDER_OFFSETS, now)) {
      await tx.obligationReminder.create({
        data: {
          buildingId: ctx.building.id,
          obligationId: obligation.id,
          offsetDays: reminder.offsetDays,
          scheduledFor: toDbDate(reminder.scheduledFor),
        },
      });
    }

    await tx.certificateOfInsurance.update({
      where: { id: certificate.id },
      data: { obligationId: obligation.id },
    });

    if (input.documentId) {
      await tx.documentLink.create({
        data: {
          buildingId: ctx.building.id,
          documentId: input.documentId,
          entityType: "CERTIFICATE_OF_INSURANCE",
          entityId: certificate.id,
        },
      });
      await tx.document.update({
        where: { id: input.documentId },
        data: { expiresOn: toDbDate(expiresOn), issuedOn: toDbDate(effectiveOn) },
      });
    }

    await recordAudit(tx, ctx, {
      action: "coi.record",
      entityType: "CERTIFICATE_OF_INSURANCE",
      entityId: certificate.id,
      after: { holderName, expiresOn },
      summary: `${holderName} certificate on file, expires ${expiresOn}`,
    });

    return ok({ certificateId: certificate.id, obligationId: obligation.id });
  });
}

/**
 * Records that someone checked the corporation is named as an additional
 * insured.
 *
 * The single most common defect in a co-op certificate: valid on its face, and
 * worthless to the building. Tracked as a separate verified fact with a name
 * against it, because "we looked at it" and "we checked the endorsement" are
 * different claims.
 */
export async function verifyCertificate(
  ctx: BuildingContext,
  input: { certificateId: string; verified: boolean; note?: string | null },
): Promise<Result<null>> {
  assertCan(ctx, "coi.manage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const certificate = await tx.certificateOfInsurance.findUnique({
      where: { id: input.certificateId },
      select: { id: true, holderName: true, additionalInsuredVerified: true },
    });
    if (!certificate) return fail("not_found", "That certificate could not be found.");

    await tx.certificateOfInsurance.update({
      where: { id: certificate.id },
      data: {
        additionalInsuredVerified: input.verified,
        verifiedById: input.verified ? ctx.membership.id : null,
        verifiedAt: input.verified ? new Date() : null,
        ...(input.note ? { note: input.note.trim() } : {}),
      },
    });

    await recordAudit(tx, ctx, {
      action: "coi.verify",
      entityType: "CERTIFICATE_OF_INSURANCE",
      entityId: certificate.id,
      before: { additionalInsuredVerified: certificate.additionalInsuredVerified },
      after: { additionalInsuredVerified: input.verified },
      summary: input.verified
        ? `${certificate.holderName} certificate names the corporation`
        : `${certificate.holderName} certificate flagged — corporation not named`,
    });

    return ok(null);
  });
}
