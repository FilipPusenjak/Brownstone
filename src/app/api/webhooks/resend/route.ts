import { NextResponse } from "next/server";
import { Webhook } from "svix";
import type { NotificationStatus } from "~/generated/prisma/enums";
import { applyDeliveryStatus } from "~/lib/db/scoped/notifications";
import { withJobTx } from "~/lib/db/tx";
import { env } from "~/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resend delivery webhooks.
 *
 * This is what turns the notification log from "we tried to send this" into
 * "this was delivered on the 14th at 6:02am", which is the difference between
 * a record and evidence.
 *
 * Signature verification uses Svix's own library — Resend signs with Svix —
 * rather than a hand-rolled HMAC check. That distinction matters more than it
 * looks: a verifier written from a guess at the scheme, tested against a
 * payload written from the same guess, passes its tests and proves nothing.
 * Using their verifier means the test exercises the real algorithm.
 *
 * Unsigned requests are refused. Anyone who can POST here unauthenticated can
 * write "delivered" against a notice that bounced, which is precisely the fact
 * a board would later rely on in a dispute.
 */

const STATUS_BY_EVENT: Record<string, NotificationStatus> = {
  "email.sent": "SENT",
  "email.delivered": "DELIVERED",
  "email.delivery_delayed": "SENT",
  "email.bounced": "BOUNCED",
  "email.complained": "COMPLAINED",
  "email.failed": "FAILED",
};

interface ResendEvent {
  type?: string;
  data?: { email_id?: string };
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = env().RESEND_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Delivery webhooks are not configured." },
      { status: 404 },
    );
  }

  const body = await request.text();
  const headers = {
    "svix-id": request.headers.get("svix-id") ?? "",
    "svix-timestamp": request.headers.get("svix-timestamp") ?? "",
    "svix-signature": request.headers.get("svix-signature") ?? "",
  };

  let event: ResendEvent;
  try {
    event = new Webhook(secret).verify(body, headers) as ResendEvent;
  } catch {
    // No detail in the response. Telling an unsigned caller *why* their
    // signature failed helps them fix it.
    return NextResponse.json({ error: "Bad signature." }, { status: 400 });
  }

  const providerMessageId = event.data?.email_id;
  const status = event.type ? STATUS_BY_EVENT[event.type] : undefined;

  if (!providerMessageId || !status) {
    // Acknowledged, not errored: an event type we do not map is not a failure
    // on Resend's part, and returning non-2xx would make them retry it forever.
    return NextResponse.json({ ok: true, ignored: event.type ?? "unknown" });
  }

  // The webhook knows a provider message id and nothing about buildings, so the
  // owning building is resolved first under the job scope — reading only the
  // building id — and the update then runs inside that building's scoped
  // transaction.
  const owner = await withJobTx((tx) =>
    tx.notification.findFirst({
      where: { providerMessageId },
      select: { buildingId: true },
    }),
  );

  if (!owner) {
    return NextResponse.json({ ok: true, ignored: "unknown message" });
  }

  await applyDeliveryStatus(owner.buildingId, providerMessageId, status);

  return NextResponse.json({ ok: true, status });
}
