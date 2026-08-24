import { render } from "@react-email/render";
import type { NoticeDeliveryMethod } from "~/generated/prisma/enums";
import { assertCan, can } from "~/lib/auth/capabilities";
import {
  AnnualNoticeEmail,
  annualNoticeSubject,
  annualNoticeText,
  type AnnualNoticeProps,
} from "~/lib/email/templates/annualNotice";
import { sendNotice } from "~/lib/email/send";
import { env } from "~/lib/env";
import { reminderDates } from "~/lib/primitives/obligations/recurrence";
import {
  NOTICES,
  describeReason,
  readResponse,
  reasonToAct,
  type ActionReason,
  type Answer,
  type NoticeType,
} from "~/lib/primitives/notices";
import { fail, ok, type Failure, type Result } from "~/lib/result";
import {
  addDays,
  compareDates,
  formatDate,
  toDbDate,
  today,
  toPlainDate,
  type PlainDate,
} from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx, type ScopedTx } from "../tx";
import { recordAudit } from "./audit";
import { canSeeAnswer, deadlinePassed } from "./notices";

/**
 * Sending the annual notices, and what comes back.
 *
 * The rule this module exists for is short and buildings get it wrong every
 * year: **an apartment that never replied is not an apartment that said no.**
 * Under the window guard law an owner who hears nothing must treat the
 * apartment as though a child lives there — inspect it, fit the guards. The
 * usual failure is to send twelve notices, receive nine forms, and file the
 * other three as "no children", which is the one reading the law does not
 * allow. So closing a campaign out does not tidy it away; it converts every
 * silence into a follow-up on the compliance calendar, with the reason written
 * on it.
 *
 * Three smaller rules follow from taking that seriously.
 *
 * **A campaign cannot be closed before the household's time is up.** Silence on
 * the fifth of February is a neighbour who has not got round to it.
 *
 * **A campaign cannot be closed while an apartment has not been sent the
 * notice at all.** You cannot conclude anything about an apartment you never
 * wrote to, in either direction — not that it consented, and not that it
 * ignored you.
 *
 * **Sending is idempotent.** The dedupe key is (campaign, unit), so a second
 * press of the button, or a retried action, cannot mail a household twice. A
 * building that double-sends its January notices teaches twelve people to
 * ignore its email, and after that the notices stop working entirely.
 */

/** How long before the notice deadline the follow-up work is due. */
const FOLLOW_UP_DAYS = 30;
const FOLLOW_UP_REMINDERS = [14, 3];

/** A household gets this long to reply unless the board says otherwise. */
const DEFAULT_RESPOND_DAYS = 30;

interface CampaignRow {
  readonly id: string;
  readonly noticeType: NoticeType;
  readonly year: number;
  readonly dueOn: Date;
  readonly respondBy: Date | null;
  readonly sentAt: Date | null;
  readonly closedAt: Date | null;
}

const CAMPAIGN_SELECT = {
  id: true,
  noticeType: true,
  year: true,
  dueOn: true,
  respondBy: true,
  sentAt: true,
  closedAt: true,
} as const;

async function campaignOr404(
  tx: ScopedTx,
  campaignId: string,
): Promise<{ ok: true; campaign: CampaignRow } | { ok: false; failure: Failure }> {
  const campaign = await tx.noticeCampaign.findUnique({
    where: { id: campaignId },
    select: CAMPAIGN_SELECT,
  });
  if (!campaign) {
    return { ok: false, failure: fail("not_found", "No such notice.") };
  }
  return { ok: true, campaign: campaign as CampaignRow };
}

// ---------------------------------------------------------------------------
// Opening one
// ---------------------------------------------------------------------------

export interface OpenCampaignInput {
  readonly noticeType: NoticeType;
  readonly year: number;
  readonly dueOn: PlainDate;
  readonly respondBy: PlainDate | null;
}

/**
 * Opens a campaign and lists every apartment it has to reach.
 *
 * A delivery row per unit, up front, before anything is sent. That is
 * deliberate: the list of who must be written to is a fact about the building
 * and not a by-product of who happened to have an email address on the day.
 * An apartment with nobody's address on file gets a row with no address, which
 * is exactly the row somebody has to walk a paper copy to — and it stays
 * visible until they do.
 */
export async function openCampaign(
  ctx: BuildingContext,
  input: OpenCampaignInput,
): Promise<Result<{ campaignId: string; households: number }>> {
  assertCan(ctx, "notice.send");

  if (!NOTICES[input.noticeType]) {
    return fail("invalid", "There is no notice of that kind.");
  }
  if (!Number.isInteger(input.year) || input.year < 2000 || input.year > 2100) {
    return fail("invalid", "That year could not be read.");
  }

  const respondBy = input.respondBy ?? addDays(input.dueOn, DEFAULT_RESPOND_DAYS);
  if (compareDates(respondBy, input.dueOn) < 0) {
    return fail(
      "invalid",
      "Households cannot be asked to reply before the notice is due to go out.",
    );
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const existing = await tx.noticeCampaign.findFirst({
      where: { noticeType: input.noticeType, year: input.year },
      select: { id: true },
    });
    if (existing) {
      return fail(
        "conflict",
        `${NOTICES[input.noticeType].title} for ${input.year} has already been opened.`,
      );
    }

    const units = await tx.unit.findMany({
      orderBy: [{ floorIndex: "asc" }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        holdings: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { holderName: true },
        },
        memberships: {
          where: { membership: { status: "ACTIVE" } },
          select: {
            membership: {
              select: { user: { select: { name: true, email: true } } },
            },
          },
        },
      },
    });

    if (units.length === 0) {
      return fail(
        "conflict",
        "This building has no apartments recorded, so there is nobody to write to.",
      );
    }

    const campaign = await tx.noticeCampaign.create({
      data: {
        buildingId: ctx.building.id,
        noticeType: input.noticeType,
        year: input.year,
        dueOn: toDbDate(input.dueOn),
        respondBy: toDbDate(respondBy),
      },
      select: { id: true },
    });

    for (const unit of units) {
      const member = unit.memberships[0]?.membership.user;
      await tx.noticeDelivery.create({
        data: {
          buildingId: ctx.building.id,
          campaignId: campaign.id,
          unitId: unit.id,
          // The name on the stock certificate first: an estate or an LLC holds
          // the shares, and the notice is addressed to the household either way.
          recipientName: unit.holdings[0]?.holderName ?? member?.name ?? unit.label,
          recipientEmail: member?.email ?? null,
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: "notice.open",
      entityType: "NOTICE_CAMPAIGN",
      entityId: campaign.id,
      after: {
        noticeType: input.noticeType,
        year: input.year,
        households: units.length,
      },
      summary: `${NOTICES[input.noticeType].title} opened for ${input.year}`,
    });

    return ok({ campaignId: campaign.id, households: units.length });
  });
}

// ---------------------------------------------------------------------------
// Sending it
// ---------------------------------------------------------------------------

/**
 * The dedupe key for one household's notice.
 *
 * (campaign, unit) and nothing else — not the date, not the address. Two
 * presses of the button a second apart produce the same key, and the second
 * loses the insert race in `sendNotice` rather than arriving in somebody's
 * inbox.
 */
export function noticeDedupeKey(campaignId: string, unitId: string): string {
  return `notice:${campaignId}:${unitId}`;
}

export interface SendSummary {
  readonly sent: number;
  readonly duplicates: number;
  readonly failed: number;
  /** Apartments with no address on file. Somebody has to walk these round. */
  readonly noAddress: number;
  readonly errors: string[];
}

/**
 * Mails the notice to every household with an address, and says who was missed.
 *
 * The notification log is written before each message is handed to the
 * provider, with the plain-text notice stored verbatim — that record is the
 * evidence, not telemetry, and it has to survive the provider being down. A
 * message that fails is recorded as failed and left visible rather than
 * retried into silence.
 */
export async function sendCampaign(
  ctx: BuildingContext,
  campaignId: string,
): Promise<Result<SendSummary>> {
  assertCan(ctx, "notice.send");

  const prepared = await withBuildingTx(ctx.building.id, async (tx) => {
    const found = await campaignOr404(tx, campaignId);
    if (!found.ok) return found;

    if (found.campaign.closedAt) {
      return {
        ok: false as const,
        failure: fail("conflict", "That notice has been closed out."),
      };
    }

    const deliveries = await tx.noticeDelivery.findMany({
      where: { campaignId, sentAt: null },
      select: {
        id: true,
        unitId: true,
        recipientName: true,
        recipientEmail: true,
        unit: { select: { label: true } },
      },
    });

    return { ok: true as const, campaign: found.campaign, deliveries };
  });

  if (!prepared.ok) return prepared.failure;

  const { campaign, deliveries } = prepared;
  const respondBy = campaign.respondBy
    ? formatDate(toPlainDate(campaign.respondBy))
    : formatDate(toPlainDate(campaign.dueOn));

  let sent = 0;
  let duplicates = 0;
  let failed = 0;
  let noAddress = 0;
  const errors: string[] = [];

  for (const delivery of deliveries) {
    if (!delivery.recipientEmail) {
      noAddress += 1;
      continue;
    }

    const props: AnnualNoticeProps = {
      buildingName: ctx.building.name,
      noticeType: campaign.noticeType,
      year: campaign.year,
      unitLabel: delivery.unit.label,
      recipientName: delivery.recipientName,
      respondBy,
      replyTo: env().EMAIL_FROM,
    };

    const outcome = await sendNotice({
      buildingId: ctx.building.id,
      to: delivery.recipientEmail,
      template: "annual-notice",
      subject: annualNoticeSubject(props),
      html: await render(AnnualNoticeEmail(props)),
      text: annualNoticeText(props),
      payload: {
        campaignId,
        unitId: delivery.unitId,
        noticeType: campaign.noticeType,
        year: campaign.year,
      },
      dedupeKey: noticeDedupeKey(campaignId, delivery.unitId),
      subjectType: "NOTICE_CAMPAIGN",
      subjectId: campaignId,
    });

    if (outcome.status === "failed") {
      failed += 1;
      errors.push(`${delivery.unit.label}: ${outcome.error}`);
    } else if (outcome.status === "duplicate") {
      duplicates += 1;
    } else {
      sent += 1;
    }

    // Marked sent for a failure too. The attempt is part of the record, and the
    // notification row carries the reason it did not arrive — hiding the row
    // would leave a board with no evidence it tried.
    if (outcome.status !== "duplicate") {
      await withBuildingTx(ctx.building.id, (tx) =>
        tx.noticeDelivery.update({
          where: { id: delivery.id },
          data: {
            method: "EMAIL",
            sentAt: new Date(),
            notificationId: outcome.notificationId,
          },
        }),
      );
    }
  }

  await withBuildingTx(ctx.building.id, async (tx) => {
    if (sent > 0 && !campaign.sentAt) {
      await tx.noticeCampaign.update({
        where: { id: campaignId },
        data: { sentAt: new Date() },
      });
    }

    await recordAudit(tx, ctx, {
      action: "notice.send",
      entityType: "NOTICE_CAMPAIGN",
      entityId: campaignId,
      after: { sent, duplicates, failed, noAddress },
      summary: `${NOTICES[campaign.noticeType].title} sent to ${sent} ${sent === 1 ? "household" : "households"}`,
    });
  });

  return ok({ sent, duplicates, failed, noAddress, errors });
}

/**
 * Records a notice delivered by hand, by post, or posted in the building.
 *
 * The apartments with no address on file, and the ones whose mail bounced. The
 * law does not care which way the notice arrived; it cares that it did, and
 * that the building can show it — which is what the document is for.
 */
export async function recordDelivery(
  ctx: BuildingContext,
  deliveryId: string,
  input: {
    method: NoticeDeliveryMethod;
    sentOn: PlainDate;
    documentId: string | null;
  },
): Promise<Result<null>> {
  assertCan(ctx, "notice.send");

  if (input.method === "EMAIL") {
    return fail(
      "invalid",
      "Email goes out through the notice itself, so that the log records what was sent.",
    );
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const delivery = await tx.noticeDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        campaignId: true,
        sentAt: true,
        unit: { select: { label: true } },
      },
    });
    if (!delivery) return fail("not_found", "No such notice.");

    if (input.documentId) {
      const document = await tx.document.findUnique({
        where: { id: input.documentId },
        select: { id: true },
      });
      // RLS confines this to the building, so a document id from elsewhere
      // simply is not found rather than being attached.
      if (!document) return fail("not_found", "That document isn't in this building.");
    }

    await tx.noticeDelivery.update({
      where: { id: deliveryId },
      data: {
        method: input.method,
        sentAt: new Date(`${input.sentOn}T12:00:00Z`),
        documentId: input.documentId,
      },
    });

    await recordAudit(tx, ctx, {
      action: "notice.recordDelivery",
      entityType: "NOTICE_DELIVERY",
      entityId: deliveryId,
      after: { method: input.method, sentOn: input.sentOn },
      summary: `${delivery.unit.label}'s notice recorded as delivered by ${input.method.toLowerCase()}`,
    });

    return ok(null);
  });
}

// ---------------------------------------------------------------------------
// What comes back
// ---------------------------------------------------------------------------

/**
 * Records a household's answer, and books the work it creates.
 *
 * A shareholder may answer for their own apartment; an officer may record any,
 * because most of these come back on paper and somebody has to type them in.
 *
 * A yes — or a request for the guards without a child in the apartment — puts
 * the work on the compliance calendar there and then. A record of an answer
 * that generates nothing is a filing cabinet; the point of asking was to find
 * out what the building owes.
 */
export async function recordResponse(
  ctx: BuildingContext,
  deliveryId: string,
  input: {
    answer: Answer;
    note: string | null;
    respondedOn: PlainDate;
    documentId: string | null;
  },
): Promise<Result<{ owedWork: boolean }>> {
  return withBuildingTx(ctx.building.id, async (tx) => {
    const delivery = await tx.noticeDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        unitId: true,
        campaignId: true,
        sentAt: true,
        obligationId: true,
        unit: { select: { label: true } },
        campaign: { select: CAMPAIGN_SELECT },
      },
    });
    if (!delivery || !canSeeAnswer(ctx, delivery.unitId)) {
      return fail("not_found", "No such notice.");
    }

    if (delivery.campaign.closedAt) {
      return fail(
        "conflict",
        "That notice has been closed out. Reopening it would change a record the board has already acted on.",
      );
    }
    if (!delivery.sentAt) {
      return fail(
        "conflict",
        "That notice hasn't gone out yet, so there is nothing for this apartment to have answered.",
      );
    }
    if (input.note && input.note.length > 500) {
      return fail("invalid", "That note is too long.");
    }

    const type = delivery.campaign.noticeType as NoticeType;
    const response = { answer: input.answer, note: input.note };
    if (!readResponse(response)) {
      return fail("invalid", "That isn't one of the answers the notice offers.");
    }

    await tx.noticeDelivery.update({
      where: { id: deliveryId },
      data: {
        respondedAt: new Date(`${input.respondedOn}T12:00:00Z`),
        response,
        recordedById: ctx.membership.id,
        ...(input.documentId ? { documentId: input.documentId } : {}),
      },
    });

    const reason = reasonToAct(type, response, false);
    if (reason) {
      await bookFollowUp(tx, ctx, {
        deliveryId,
        unitLabel: delivery.unit.label,
        noticeType: type,
        reason,
        dueOn: addDays(today(ctx.building.timezone), FOLLOW_UP_DAYS),
        existing: delivery.obligationId,
      });
    }

    await recordAudit(tx, ctx, {
      action: "notice.recordResponse",
      entityType: "NOTICE_DELIVERY",
      entityId: deliveryId,
      after: { answer: input.answer, respondedOn: input.respondedOn },
      summary: `${delivery.unit.label} answered the ${NOTICES[type].title.toLowerCase()}`,
    });

    return ok({ owedWork: reason !== null });
  });
}

// ---------------------------------------------------------------------------
// Closing it out
// ---------------------------------------------------------------------------

/**
 * Closes the campaign, turning every silence into work.
 *
 * This is the act the module exists for. Until it happens, an apartment that
 * has not replied is a neighbour who has not got round to it; afterwards, for
 * the notices where the law says so, it is an apartment the building must treat
 * as though a child lives there. Each one gets a follow-up on the compliance
 * calendar carrying the reason, so a board three years later can see not just
 * that the guards went in but why they had to.
 *
 * Refused before the reply-by date, and refused while any apartment has not
 * been sent the notice at all. The second is the one worth stating: an
 * apartment nobody wrote to has not consented and has not ignored you, and
 * closing the campaign around it would record a conclusion nobody is entitled
 * to draw.
 */
export async function closeCampaign(
  ctx: BuildingContext,
  campaignId: string,
): Promise<Result<{ followUps: number }>> {
  assertCan(ctx, "notice.send");

  const now = today(ctx.building.timezone);

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await campaignOr404(tx, campaignId);
    if (!found.ok) return found.failure;
    const campaign = found.campaign;

    if (campaign.closedAt) {
      return fail("conflict", "That notice has already been closed out.");
    }
    if (!deadlinePassed(campaign, now)) {
      const by = campaign.respondBy
        ? formatDate(toPlainDate(campaign.respondBy))
        : "the reply-by date";
      return fail(
        "conflict",
        `Households have until ${by} to reply. Closing it now would record silence as an answer before anyone was late.`,
      );
    }

    const deliveries = await tx.noticeDelivery.findMany({
      where: { campaignId },
      select: {
        id: true,
        unitId: true,
        sentAt: true,
        response: true,
        obligationId: true,
        unit: { select: { label: true } },
      },
    });

    const unsent = deliveries.filter((delivery) => !delivery.sentAt);
    if (unsent.length > 0) {
      const labels = unsent.map((delivery) => delivery.unit.label).join(", ");
      return fail(
        "conflict",
        `${labels} ${unsent.length === 1 ? "has" : "have"} not been sent the notice. An apartment nobody wrote to has neither answered nor ignored you — record how it was delivered first.`,
      );
    }

    const type = campaign.noticeType;
    let followUps = 0;

    for (const delivery of deliveries) {
      const reason = reasonToAct(type, readResponse(delivery.response), true);
      if (!reason) continue;

      const created = await bookFollowUp(tx, ctx, {
        deliveryId: delivery.id,
        unitLabel: delivery.unit.label,
        noticeType: type,
        reason,
        dueOn: addDays(now, FOLLOW_UP_DAYS),
        existing: delivery.obligationId,
      });
      if (created) followUps += 1;
    }

    await tx.noticeCampaign.update({
      where: { id: campaignId },
      data: { closedAt: new Date(), closedById: ctx.membership.id },
    });

    await recordAudit(tx, ctx, {
      action: "notice.close",
      entityType: "NOTICE_CAMPAIGN",
      entityId: campaignId,
      after: { followUps, households: deliveries.length },
      summary:
        followUps === 0
          ? `${NOTICES[type].title} closed with nothing outstanding`
          : `${NOTICES[type].title} closed — ${followUps} ${followUps === 1 ? "apartment" : "apartments"} to be seen to`,
    });

    return ok({ followUps });
  });
}

/**
 * Puts one apartment's follow-up on the compliance calendar.
 *
 * The same machinery a sublet expiry uses. Returns false when the apartment
 * already has one, so re-running a close — or answering yes after already
 * being counted as silent — does not stack up duplicates for the same work.
 */
async function bookFollowUp(
  tx: ScopedTx,
  ctx: BuildingContext,
  input: {
    deliveryId: string;
    unitLabel: string;
    noticeType: NoticeType;
    reason: ActionReason;
    dueOn: PlainDate;
    existing: string | null;
  },
): Promise<boolean> {
  if (input.existing) return false;

  const spec = NOTICES[input.noticeType];

  const obligation = await tx.obligation.create({
    data: {
      buildingId: ctx.building.id,
      kind: "NOTICE",
      title: `${input.unitLabel} — ${spec.owed}`,
      detail: describeReason(input.noticeType, input.reason),
      dueOn: toDbDate(input.dueOn),
      recurrenceType: "NONE",
      reminderOffsets: FOLLOW_UP_REMINDERS,
      ruleCode: spec.ruleCode,
      subjectType: "NOTICE_DELIVERY",
      subjectId: input.deliveryId,
      state: "OPEN",
    },
    select: { id: true },
  });

  for (const reminder of reminderDates(
    input.dueOn,
    FOLLOW_UP_REMINDERS,
    today(ctx.building.timezone),
  )) {
    await tx.obligationReminder.create({
      data: {
        buildingId: ctx.building.id,
        obligationId: obligation.id,
        offsetDays: reminder.offsetDays,
        scheduledFor: toDbDate(reminder.scheduledFor),
      },
    });
  }

  await tx.noticeDelivery.update({
    where: { id: input.deliveryId },
    data: { obligationId: obligation.id },
  });

  return true;
}

/** Whether this member may record an answer for an apartment. */
export function mayAnswerFor(ctx: BuildingContext, unitId: string): boolean {
  return can(ctx, "notice.send") || ctx.unitIds.includes(unitId);
}
