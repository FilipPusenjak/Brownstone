import { can } from "~/lib/auth/capabilities";
import {
  NOTICES,
  readResponse,
  reasonToAct,
  standingOf,
  type ActionReason,
  type DeliveryFacts,
  type NoticeResponse,
  type NoticeType,
  type Standing,
} from "~/lib/primitives/notices";
import { compareDates, today, toPlainDate, type PlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";

/**
 * The annual notices, and who is owed what.
 *
 * Two things shape the reads here.
 *
 * **The standing is public; the answers are not.** Whether the building has
 * sent this year's window guard notice, and how many apartments are still owed
 * work, is everybody's business — it is a compliance fact about the building.
 * *Which* apartment answered that a child under six lives there is not. So the
 * counts go to every member and the per-apartment answers go to the board and
 * to the apartment itself, in the same shape bookings uses.
 *
 * **A campaign's standing depends on the date.** An apartment that has not
 * replied is a household still thinking about it until the reply-by date, and
 * work the building owes the day after. Nothing about that is stored; it is
 * read from the deadline every time, because a stored flag would be wrong for
 * exactly one day and nobody would notice which one.
 */

const CAMPAIGN_SELECT = {
  id: true,
  buildingId: true,
  noticeType: true,
  year: true,
  dueOn: true,
  respondBy: true,
  sentAt: true,
  closedAt: true,
  obligationId: true,
  closedBy: { select: { user: { select: { name: true, email: true } } } },
} as const;

const DELIVERY_SELECT = {
  id: true,
  buildingId: true,
  campaignId: true,
  unitId: true,
  recipientName: true,
  recipientEmail: true,
  method: true,
  sentAt: true,
  respondedAt: true,
  response: true,
  notificationId: true,
  documentId: true,
  obligationId: true,
  unit: { select: { id: true, label: true } },
  recordedBy: { select: { user: { select: { name: true, email: true } } } },
} as const;

/** Whether this member may see a single apartment's answer. */
export function canSeeAnswer(ctx: BuildingContext, unitId: string): boolean {
  return can(ctx, "notice.send") || ctx.unitIds.includes(unitId);
}

/** Whether the household's time to reply has run out. */
export function deadlinePassed(
  campaign: { respondBy: Date | null },
  asOf: PlainDate,
): boolean {
  if (!campaign.respondBy) return false;
  return compareDates(toPlainDate(campaign.respondBy), asOf) < 0;
}

export interface CampaignSummary {
  readonly id: string;
  readonly noticeType: NoticeType;
  readonly year: number;
  readonly dueOn: Date;
  readonly respondBy: Date | null;
  readonly sentAt: Date | null;
  readonly closedAt: Date | null;
  readonly standing: Standing;
  readonly deadlinePassed: boolean;
}

/**
 * Every campaign, with its standing. Visible to any member.
 *
 * The counts are computed from the delivery rows rather than stored on the
 * campaign, for the same reason obligation status is derived: a stored count
 * goes stale the first time somebody records a reply and it is never obvious
 * which of the two numbers is the true one.
 */
export async function listCampaigns(ctx: BuildingContext): Promise<CampaignSummary[]> {
  const now = today(ctx.building.timezone);

  const rows = await withBuildingTx(ctx.building.id, (tx) =>
    tx.noticeCampaign.findMany({
      orderBy: [{ year: "desc" }, { noticeType: "asc" }],
      select: {
        ...CAMPAIGN_SELECT,
        deliveries: {
          select: { unitId: true, sentAt: true, response: true, notificationId: true },
        },
      },
    }),
  );

  const bounced = await bouncedNotifications(
    ctx,
    rows.flatMap((row) =>
      row.deliveries
        .map((delivery) => delivery.notificationId)
        .filter((id): id is string => Boolean(id)),
    ),
  );

  return rows.map((row) => {
    const passed = deadlinePassed(row, now);
    const facts: DeliveryFacts[] = row.deliveries.map((delivery) => ({
      unitId: delivery.unitId,
      sent: delivery.sentAt !== null,
      bounced: delivery.notificationId ? bounced.has(delivery.notificationId) : false,
      response: readResponse(delivery.response),
    }));

    return {
      id: row.id,
      noticeType: row.noticeType as NoticeType,
      year: row.year,
      dueOn: row.dueOn,
      respondBy: row.respondBy,
      sentAt: row.sentAt,
      closedAt: row.closedAt,
      standing: standingOf(row.noticeType as NoticeType, facts, passed),
      deadlinePassed: passed,
    };
  });
}

export interface DeliveryRow {
  readonly id: string;
  readonly unitId: string;
  readonly unitLabel: string;
  readonly recipientName: string;
  readonly recipientEmail: string | null;
  readonly method: string | null;
  readonly sentAt: Date | null;
  readonly respondedAt: Date | null;
  readonly response: NoticeResponse | null;
  readonly bounced: boolean;
  readonly deliveryStatus: string | null;
  readonly documentId: string | null;
  readonly obligationId: string | null;
  readonly recordedBy: string | null;
  readonly reason: ActionReason | null;
  /** Whether this member may read the answer, or only that one was given. */
  readonly visible: boolean;
}

export async function getCampaign(ctx: BuildingContext, campaignId: string) {
  const now = today(ctx.building.timezone);

  const campaign = await withBuildingTx(ctx.building.id, (tx) =>
    tx.noticeCampaign.findUnique({
      where: { id: campaignId },
      select: {
        ...CAMPAIGN_SELECT,
        deliveries: {
          orderBy: { unit: { label: "asc" } },
          select: DELIVERY_SELECT,
        },
      },
    }),
  );
  if (!campaign) return null;

  const statuses = await notificationStatuses(
    ctx,
    campaign.deliveries
      .map((delivery) => delivery.notificationId)
      .filter((id): id is string => Boolean(id)),
  );

  const passed = deadlinePassed(campaign, now);
  const type = campaign.noticeType as NoticeType;

  const deliveries: DeliveryRow[] = campaign.deliveries.map((delivery) => {
    const response = readResponse(delivery.response);
    const status = delivery.notificationId
      ? (statuses.get(delivery.notificationId) ?? null)
      : null;
    const visible = canSeeAnswer(ctx, delivery.unitId);

    return {
      id: delivery.id,
      unitId: delivery.unitId,
      unitLabel: delivery.unit.label,
      recipientName: visible ? delivery.recipientName : delivery.unit.label,
      recipientEmail: visible ? delivery.recipientEmail : null,
      method: delivery.method,
      sentAt: delivery.sentAt,
      respondedAt: delivery.respondedAt,
      // The count of answers is a building fact; the answer is not.
      response: visible ? response : null,
      bounced: status === "BOUNCED" || status === "FAILED",
      deliveryStatus: status,
      documentId: visible ? delivery.documentId : null,
      obligationId: delivery.obligationId,
      recordedBy: visible
        ? (delivery.recordedBy?.user.name ?? delivery.recordedBy?.user.email ?? null)
        : null,
      reason: reasonToAct(type, response, passed),
      visible,
    };
  });

  const standing = standingOf(
    type,
    campaign.deliveries.map((delivery) => ({
      unitId: delivery.unitId,
      sent: delivery.sentAt !== null,
      bounced: delivery.notificationId
        ? statuses.get(delivery.notificationId) === "BOUNCED"
        : false,
      response: readResponse(delivery.response),
    })),
    passed,
  );

  return {
    id: campaign.id,
    noticeType: type,
    spec: NOTICES[type],
    year: campaign.year,
    dueOn: campaign.dueOn,
    respondBy: campaign.respondBy,
    sentAt: campaign.sentAt,
    closedAt: campaign.closedAt,
    closedBy: campaign.closedBy?.user.name ?? campaign.closedBy?.user.email ?? null,
    deadlinePassed: passed,
    standing,
    deliveries,
  };
}

export type CampaignDetail = NonNullable<Awaited<ReturnType<typeof getCampaign>>>;

/**
 * What the provider said about each message.
 *
 * Read from the notification log rather than mirrored onto the delivery row.
 * The log is the evidence — written before dispatch, updated by the webhook —
 * and a second copy of a status is a second thing to be wrong.
 */
async function notificationStatuses(
  ctx: BuildingContext,
  ids: string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();

  const rows = await withBuildingTx(ctx.building.id, (tx) =>
    tx.notification.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true },
    }),
  );

  return new Map(rows.map((row) => [row.id, row.status]));
}

async function bouncedNotifications(
  ctx: BuildingContext,
  ids: string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();

  const rows = await withBuildingTx(ctx.building.id, (tx) =>
    tx.notification.findMany({
      where: { id: { in: ids }, status: { in: ["BOUNCED", "FAILED"] } },
      select: { id: true },
    }),
  );

  return new Set(rows.map((row) => row.id));
}

/**
 * The notification log for one campaign: what was sent, verbatim.
 *
 * Board only. This is the artefact a building produces when a shareholder says
 * they never received the notice, and it carries the address it went to.
 */
export async function noticeLog(ctx: BuildingContext, campaignId: string) {
  if (!can(ctx, "notice.send")) return [];

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.notification.findMany({
      where: { subjectType: "NOTICE_CAMPAIGN", subjectId: campaignId },
      orderBy: { queuedAt: "asc" },
      select: {
        id: true,
        recipientEmail: true,
        subject: true,
        textBody: true,
        status: true,
        queuedAt: true,
        sentAt: true,
        deliveredAt: true,
        failedAt: true,
        lastError: true,
      },
    }),
  );
}

/** Unfiltered reads used by the tenancy suite. */
export async function listCampaignsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.noticeCampaign.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listDeliveriesForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.noticeDelivery.findMany({ select: { id: true, buildingId: true } }),
  );
}
