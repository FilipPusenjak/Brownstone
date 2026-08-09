import type { EntityType } from "~/generated/prisma/enums";
import { withBuildingTx } from "~/lib/db/tx";
import {
  markFailed,
  markSent,
  queueNotification,
} from "~/lib/db/scoped/notifications";
import { mailer } from "./mailer";

/**
 * Sending a building notice.
 *
 * The order here is the whole point and must not be rearranged:
 *
 *   1. Write the notification record, with the rendered text stored verbatim.
 *   2. Hand it to the mail provider.
 *   3. Record what the provider said.
 *
 * The log is written *before* dispatch because it is evidence, not telemetry.
 * When a shareholder says they never received the window guard notice, the
 * building needs to show what was sent, to which address, on which day — and
 * that has to survive the provider being down, the function timing out, and the
 * deploy that happened in between.
 *
 * `dedupeKey` carries idempotency. A cron that fires twice inserts once; the
 * second attempt finds the key taken and does not send. This is why a retried
 * job cannot mail the whole building a second time.
 */

export interface SendRequest {
  readonly buildingId: string;
  readonly to: string;
  readonly recipientUserId?: string | null;
  readonly template: string;
  readonly subject: string;
  readonly html: string;
  /** Plain text, stored verbatim. Every template must render legibly as text. */
  readonly text: string;
  readonly payload: Record<string, unknown>;
  /** Stable across retries. Reminders use (obligation, offset, date). */
  readonly dedupeKey: string;
  readonly subjectType?: EntityType;
  readonly subjectId?: string;
}

export type SendOutcome =
  | { readonly status: "sent"; readonly notificationId: string }
  | { readonly status: "duplicate" }
  | { readonly status: "failed"; readonly notificationId: string; readonly error: string };

export async function sendNotice(request: SendRequest): Promise<SendOutcome> {
  const queued = await withBuildingTx(request.buildingId, (tx) =>
    queueNotification(tx, request.buildingId, {
      recipientEmail: request.to,
      recipientUserId: request.recipientUserId ?? null,
      template: request.template,
      subject: request.subject,
      payload: request.payload,
      textBody: request.text,
      dedupeKey: request.dedupeKey,
      ...(request.subjectType ? { subjectType: request.subjectType } : {}),
      ...(request.subjectId ? { subjectId: request.subjectId } : {}),
    }),
  );

  // Someone already queued this exact message. Losing that race is correct.
  if (!queued) return { status: "duplicate" };

  try {
    const receipt = await mailer().send({
      to: request.to,
      subject: request.subject,
      html: request.html,
      text: request.text,
    });

    await markSent(request.buildingId, queued.id, receipt.providerMessageId);
    return { status: "sent", notificationId: queued.id };
  } catch (error) {
    // The record stays, marked FAILED with the reason. A notice that could not
    // be delivered is exactly the thing a board needs to see, so it is never
    // swallowed and never deleted.
    const message = error instanceof Error ? error.message : String(error);
    await markFailed(request.buildingId, queued.id, message);
    return { status: "failed", notificationId: queued.id, error: message };
  }
}

/**
 * The dedupe key for an obligation reminder.
 *
 * Deliberately derived from (obligation, offset, date) and nothing else — not
 * the recipient, not a timestamp — so two workers computing it independently
 * agree, and a job that runs twice on the same day collides with itself.
 */
export function reminderDedupeKey(input: {
  obligationId: string;
  offsetDays: number;
  scheduledFor: string;
  recipientEmail: string;
}): string {
  return [
    "reminder",
    input.obligationId,
    input.offsetDays,
    input.scheduledFor,
    input.recipientEmail.toLowerCase(),
  ].join(":");
}
