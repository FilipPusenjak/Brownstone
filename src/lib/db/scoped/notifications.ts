import type { EntityType, NotificationStatus } from "~/generated/prisma/enums";
import type { BuildingContext } from "../context";
import type { ScopedTx } from "../tx";
import { withBuildingTx } from "../tx";

/**
 * The notification log.
 *
 * This is not observability. When a shareholder says they never received the
 * window guard notice, this table is what the building shows. So the record is
 * written *before* anything is handed to a mail provider, and updated after —
 * a send that fails still leaves evidence that the building tried, and when.
 *
 * `dedupeKey` carries the idempotency guarantee. Reminder sends derive it from
 * (obligation, offset, date), so a cron that fires twice inserts once and the
 * second attempt loses the race rather than mailing the building again.
 */

export interface QueuedNotification {
  readonly recipientEmail: string;
  readonly recipientUserId?: string | null;
  readonly template: string;
  readonly subject: string;
  readonly payload: Record<string, unknown>;
  /** The plain-text rendering, stored verbatim as sent. */
  readonly textBody: string;
  readonly dedupeKey: string;
  readonly subjectType?: EntityType;
  readonly subjectId?: string;
}

/**
 * Writes the QUEUED record. Returns null when `dedupeKey` already exists, which
 * is the caller's signal that this message was already handled and must not be
 * sent again.
 */
export async function queueNotification(
  tx: ScopedTx,
  buildingId: string,
  notification: QueuedNotification,
): Promise<{ id: string } | null> {
  const existing = await tx.notification.findUnique({
    where: { dedupeKey: notification.dedupeKey },
    select: { id: true },
  });
  if (existing) return null;

  try {
    return await tx.notification.create({
      data: {
        buildingId,
        recipientEmail: notification.recipientEmail,
        recipientUserId: notification.recipientUserId ?? null,
        template: notification.template,
        subject: notification.subject,
        payload: notification.payload as never,
        textBody: notification.textBody,
        dedupeKey: notification.dedupeKey,
        subjectType: notification.subjectType ?? null,
        subjectId: notification.subjectId ?? null,
        status: "QUEUED",
      },
      select: { id: true },
    });
  } catch (error) {
    // Unique violation: another worker queued it between the check and the
    // insert. Losing that race is the correct outcome — it means someone else
    // is sending it.
    if ((error as { code?: string }).code === "P2002") return null;
    throw error;
  }
}

export async function markSent(
  buildingId: string,
  notificationId: string,
  providerMessageId: string,
): Promise<void> {
  await withBuildingTx(buildingId, (tx) =>
    tx.notification.update({
      where: { id: notificationId },
      data: { status: "SENT", sentAt: new Date(), providerMessageId },
    }),
  );
}

export async function markFailed(
  buildingId: string,
  notificationId: string,
  error: string,
): Promise<void> {
  await withBuildingTx(buildingId, (tx) =>
    tx.notification.update({
      where: { id: notificationId },
      data: { status: "FAILED", failedAt: new Date(), lastError: error.slice(0, 2000) },
    }),
  );
}

/** Applied from the provider's delivery webhook. */
export async function applyDeliveryStatus(
  buildingId: string,
  providerMessageId: string,
  status: NotificationStatus,
): Promise<void> {
  await withBuildingTx(buildingId, async (tx) => {
    const record = await tx.notification.findFirst({
      where: { providerMessageId },
      select: { id: true },
    });
    if (!record) return;

    await tx.notification.update({
      where: { id: record.id },
      data: {
        status,
        ...(status === "DELIVERED" ? { deliveredAt: new Date() } : {}),
        ...(status === "BOUNCED" || status === "FAILED" ? { failedAt: new Date() } : {}),
      },
    });
  });
}

export async function listNotifications(
  ctx: BuildingContext,
  options: { limit?: number; subjectType?: EntityType; subjectId?: string } = {},
) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.notification.findMany({
      where: {
        ...(options.subjectType ? { subjectType: options.subjectType } : {}),
        ...(options.subjectId ? { subjectId: options.subjectId } : {}),
      },
      orderBy: { queuedAt: "desc" },
      take: options.limit ?? 100,
      select: {
        id: true,
        buildingId: true,
        recipientEmail: true,
        template: true,
        subject: true,
        status: true,
        queuedAt: true,
        sentAt: true,
        deliveredAt: true,
        failedAt: true,
        lastError: true,
        providerMessageId: true,
      },
    }),
  );
}
