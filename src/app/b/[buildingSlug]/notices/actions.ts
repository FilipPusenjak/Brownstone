"use server";

import { revalidatePath } from "next/cache";
import type { NoticeDeliveryMethod } from "~/generated/prisma/enums";
import { CapabilityError } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import {
  closeCampaign,
  openCampaign,
  recordDelivery,
  recordResponse,
  sendCampaign,
  type SendSummary,
} from "~/lib/db/scoped/notice-writes";
import type { Answer, NoticeType } from "~/lib/primitives/notices";
import { fail, type Result } from "~/lib/result";
import { isPlainDate, plainDate } from "~/lib/time";

/**
 * Server Actions for the annual notices.
 *
 * Each resolves its own context from the session and the slug in the URL. A
 * posted building id would be a tenancy hole with a submit button attached.
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

function refresh(buildingSlug: string, campaignId?: string): void {
  revalidatePath(`/b/${buildingSlug}/notices`);
  if (campaignId) revalidatePath(`/b/${buildingSlug}/notices/${campaignId}`);
  // A notice that obliges the building puts work on the calendar, so that page
  // is stale the moment this one changes.
  revalidatePath(`/b/${buildingSlug}/compliance`);
}

export async function openCampaignAction(input: {
  buildingSlug: string;
  noticeType: NoticeType;
  year: number;
  dueOn: string;
  respondBy: string;
}): Promise<Result<{ campaignId: string; households: number }>> {
  if (!isPlainDate(input.dueOn)) {
    return fail("invalid", "That date could not be read.", {
      dueOn: "The day the notice has to go out.",
    });
  }
  if (input.respondBy && !isPlainDate(input.respondBy)) {
    return fail("invalid", "That date could not be read.", {
      respondBy: "The day households have until.",
    });
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    openCampaign(ctx, {
      noticeType: input.noticeType,
      year: input.year,
      dueOn: plainDate(input.dueOn),
      respondBy: input.respondBy ? plainDate(input.respondBy) : null,
    }),
  );

  if (result.ok) refresh(input.buildingSlug, result.data.campaignId);
  return result;
}

export async function sendCampaignAction(input: {
  buildingSlug: string;
  campaignId: string;
}): Promise<Result<SendSummary>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    sendCampaign(ctx, input.campaignId),
  );

  // Refreshed either way: a run that failed halfway still sent some of them,
  // and the page has to show which.
  refresh(input.buildingSlug, input.campaignId);
  return result;
}

export async function recordDeliveryAction(input: {
  buildingSlug: string;
  campaignId: string;
  deliveryId: string;
  method: NoticeDeliveryMethod;
  sentOn: string;
}): Promise<Result<null>> {
  if (!isPlainDate(input.sentOn)) {
    return fail("invalid", "That date could not be read.", {
      sentOn: "The day it was delivered.",
    });
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    recordDelivery(ctx, input.deliveryId, {
      method: input.method,
      sentOn: plainDate(input.sentOn),
      documentId: null,
    }),
  );

  if (result.ok) refresh(input.buildingSlug, input.campaignId);
  return result;
}

export async function recordResponseAction(input: {
  buildingSlug: string;
  campaignId: string;
  deliveryId: string;
  answer: Answer;
  note: string;
  respondedOn: string;
}): Promise<Result<{ owedWork: boolean }>> {
  if (!isPlainDate(input.respondedOn)) {
    return fail("invalid", "That date could not be read.", {
      respondedOn: "The day they answered.",
    });
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    recordResponse(ctx, input.deliveryId, {
      answer: input.answer,
      note: input.note.trim() || null,
      respondedOn: plainDate(input.respondedOn),
      documentId: null,
    }),
  );

  if (result.ok) refresh(input.buildingSlug, input.campaignId);
  return result;
}

export async function closeCampaignAction(input: {
  buildingSlug: string;
  campaignId: string;
}): Promise<Result<{ followUps: number }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    closeCampaign(ctx, input.campaignId),
  );

  if (result.ok) refresh(input.buildingSlug, input.campaignId);
  return result;
}
