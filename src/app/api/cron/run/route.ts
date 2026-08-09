import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { runReminders } from "~/lib/primitives/obligations/reminders";
import { env } from "~/lib/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The daily job.
 *
 * One endpoint, one job, invoked by the `crons` entry in vercel.json at 11:00
 * UTC — 6am or 7am in New York depending on the season, which is early enough
 * that a board member finds the reminder waiting rather than watching it land.
 *
 * Idempotent by construction, so it is safe to hit twice: see the note in
 * `src/lib/primitives/obligations/reminders.ts`. That matters because Vercel
 * Cron does not guarantee exactly-once delivery, and because someone will
 * eventually curl this by hand to see what it does.
 *
 * Both GET and POST are accepted. Vercel Cron sends GET with the bearer token;
 * POST is here for anyone driving it from an external scheduler.
 */

function authorised(request: Request): boolean {
  const expected = env().CRON_SECRET;
  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

  // Constant-time, and length-checked first because timingSafeEqual throws on
  // a length mismatch. A plain === would leak the secret's prefix a byte at a
  // time to anyone patient enough to measure.
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(request: Request): Promise<NextResponse> {
  if (!authorised(request)) {
    return NextResponse.json({ error: "Not authorised." }, { status: 401 });
  }

  const startedAt = Date.now();

  try {
    const summary = await runReminders();
    const durationMs = Date.now() - startedAt;

    // Every run is logged, including the quiet ones. "Did the cron run
    // yesterday?" is the first question when a reminder does not arrive, and
    // silence is not an answer.
    console.info(
      `[cron] ${summary.ranAt} — ${summary.remindersDue} filings due, ${summary.sent} sent, ` +
        `${summary.collapsed} folded in, ${summary.duplicates} already sent, ` +
        `${summary.failed} failed, ${durationMs}ms`,
    );
    for (const error of summary.errors) console.error(`[cron] ${error}`);

    return NextResponse.json({ ok: true, durationMs, ...summary });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[cron] run failed: ${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
