"use server";

import { revalidatePath } from "next/cache";
import type { AttendanceMode, MeetingType, VoteChoice } from "~/generated/prisma/enums";
import { CapabilityError } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import {
  adoptMinutes,
  clearAttendance,
  grantProxy,
  recordAttendance,
  recordResolution,
  revokeProxy,
  saveMinutes,
  scheduleMeeting,
  updateMeeting,
  type RecordResolutionResult,
} from "~/lib/db/scoped/meeting-writes";
import { fail, type Result } from "~/lib/result";
import { instantAt, isPlainDate, plainDate } from "~/lib/time";

/**
 * Server Actions for meetings.
 *
 * Every one of these resolves its own context from the session and the URL
 * slug. Nothing trusts a posted building id — a form field naming the building
 * is a form field an attacker edits.
 */

async function guard<T>(
  buildingSlug: string,
  run: (ctx: Awaited<ReturnType<typeof getBuildingContext>>) => Promise<Result<T>>,
): Promise<Result<T>> {
  try {
    return await run(await getBuildingContext(buildingSlug));
  } catch (error) {
    if (error instanceof NotSignedInError) {
      return fail("unauthenticated", "Your session has expired. Sign in again.");
    }
    if (error instanceof NoSuchBuildingError) {
      return fail("not_found", "You're not a member of this building.");
    }
    if (error instanceof CapabilityError) {
      return fail("forbidden", "You don't have permission to do that.");
    }
    throw error;
  }
}

/**
 * A date and a wall-clock time in the building's own timezone.
 *
 * A meeting called for "7.30pm on 12 November" is 7.30pm in Brooklyn, not in
 * UTC, and storing the browser's idea of the instant puts the annual meeting an
 * hour out for five months of the year.
 */
function instantFrom(
  date: string,
  time: string,
  timezone: string,
): { ok: true; at: Date } | { ok: false; failure: ReturnType<typeof fail> } {
  if (!isPlainDate(date)) {
    return {
      ok: false,
      failure: fail("invalid", "That date could not be read.", {
        scheduledFor: "Pick the day the meeting is.",
      }),
    };
  }
  if (!/^\d{2}:\d{2}$/.test(time)) {
    return {
      ok: false,
      failure: fail("invalid", "That time could not be read.", {
        scheduledFor: "Give a time like 19:30.",
      }),
    };
  }
  return { ok: true, at: instantAt(plainDate(date), `${time}:00`, timezone) };
}

export async function scheduleMeetingAction(input: {
  buildingSlug: string;
  title: string;
  type: MeetingType;
  date: string;
  time: string;
  location?: string | null;
  agenda?: string | null;
  quorumNumerator: number;
  quorumDenominator: number;
  quorumStrict: boolean;
}): Promise<Result<{ meetingId: string }>> {
  const result = await guard(input.buildingSlug, async (ctx) => {
    const when = instantFrom(input.date, input.time, ctx.building.timezone);
    if (!when.ok) return when.failure;

    return scheduleMeeting(ctx, {
      title: input.title,
      type: input.type,
      scheduledFor: when.at,
      location: input.location ?? null,
      agenda: input.agenda ?? null,
      quorumNumerator: input.quorumNumerator,
      quorumDenominator: input.quorumDenominator,
      quorumStrict: input.quorumStrict,
    });
  });

  if (result.ok) revalidateMeetings(input.buildingSlug);
  return result;
}

export async function updateMeetingAction(input: {
  buildingSlug: string;
  meetingId: string;
  title?: string;
  date?: string;
  time?: string;
  location?: string | null;
  agenda?: string | null;
  held?: boolean;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, async (ctx) => {
    let scheduledFor: Date | undefined;
    if (input.date !== undefined && input.time !== undefined) {
      const when = instantFrom(input.date, input.time, ctx.building.timezone);
      if (!when.ok) return when.failure;
      scheduledFor = when.at;
    }

    return updateMeeting(ctx, input.meetingId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(scheduledFor !== undefined ? { scheduledFor } : {}),
      ...(input.location !== undefined ? { location: input.location } : {}),
      ...(input.agenda !== undefined ? { agenda: input.agenda } : {}),
      ...(input.held !== undefined ? { heldAt: input.held ? new Date() : null } : {}),
    });
  });

  if (result.ok) revalidateMeetings(input.buildingSlug);
  return result;
}

export async function recordAttendanceAction(input: {
  buildingSlug: string;
  meetingId: string;
  unitId: string;
  mode: AttendanceMode;
  representedBy?: string | null;
}): Promise<Result<{ attendanceId: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    recordAttendance(ctx, input.meetingId, {
      unitId: input.unitId,
      mode: input.mode,
      representedBy: input.representedBy ?? null,
    }),
  );

  if (result.ok) revalidateMeetings(input.buildingSlug);
  return result;
}

export async function clearAttendanceAction(input: {
  buildingSlug: string;
  meetingId: string;
  unitId: string;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    clearAttendance(ctx, input.meetingId, input.unitId),
  );

  if (result.ok) revalidateMeetings(input.buildingSlug);
  return result;
}

export async function grantProxyAction(input: {
  buildingSlug: string;
  meetingId: string;
  unitId: string;
  holderName: string;
  holderId?: string | null;
  evidence?: string | null;
}): Promise<Result<{ proxyId: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    grantProxy(ctx, input.meetingId, {
      unitId: input.unitId,
      holderName: input.holderName,
      holderId: input.holderId ?? null,
      evidence: input.evidence ?? null,
    }),
  );

  if (result.ok) revalidateMeetings(input.buildingSlug);
  return result;
}

export async function revokeProxyAction(input: {
  buildingSlug: string;
  proxyId: string;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    revokeProxy(ctx, input.proxyId),
  );

  if (result.ok) revalidateMeetings(input.buildingSlug);
  return result;
}

export async function recordResolutionAction(input: {
  buildingSlug: string;
  meetingId: string;
  title: string;
  text: string;
  votes: Array<{ unitId: string; choice: VoteChoice; byProxy?: boolean }>;
  thresholdNumerator: number;
  thresholdDenominator: number;
  thresholdStrict: boolean;
  basis: "VOTED" | "PRESENT" | "OUTSTANDING";
}): Promise<Result<RecordResolutionResult>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    recordResolution(ctx, input.meetingId, {
      title: input.title,
      text: input.text,
      votes: input.votes,
      thresholdNumerator: input.thresholdNumerator,
      thresholdDenominator: input.thresholdDenominator,
      thresholdStrict: input.thresholdStrict,
      basis: input.basis,
    }),
  );

  if (result.ok) revalidateMeetings(input.buildingSlug);
  return result;
}

export async function saveMinutesAction(input: {
  buildingSlug: string;
  meetingId: string;
  minutes: string;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    saveMinutes(ctx, input.meetingId, input.minutes),
  );

  if (result.ok) revalidateMeetings(input.buildingSlug);
  return result;
}

export async function adoptMinutesAction(input: {
  buildingSlug: string;
  meetingId: string;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    adoptMinutes(ctx, input.meetingId),
  );

  if (result.ok) revalidateMeetings(input.buildingSlug);
  return result;
}

function revalidateMeetings(buildingSlug: string): void {
  revalidatePath(`/b/${buildingSlug}/meetings`);
  // A literal path does not cover dynamic children, so the detail page is
  // revalidated by its route pattern.
  revalidatePath("/b/[buildingSlug]/meetings/[meetingId]", "page");
  revalidatePath(`/b/${buildingSlug}/audit`);
}
