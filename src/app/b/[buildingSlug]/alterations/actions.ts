"use server";

import { revalidatePath } from "next/cache";
import { CapabilityError } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import {
  actOnAlteration,
  commentOnAlteration,
  recordCertificate,
  submitAlteration,
  verifyCertificate,
  type RecordCoiInput,
  type SubmitAlterationInput,
} from "~/lib/db/scoped/alteration-writes";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import type { ApprovalAction } from "~/lib/primitives/approvals";
import { fail, type Result } from "~/lib/result";

/**
 * Server Actions for alterations, certificates and their documents.
 *
 * Each resolves its own BuildingContext from the session and the slug in the
 * URL — never from anything the form posted. A hidden `buildingId` field would
 * be a tenancy hole with a submit button attached.
 */

async function guard<T>(
  buildingSlug: string,
  run: (ctx: Awaited<ReturnType<typeof getBuildingContext>>) => Promise<Result<T>>,
): Promise<Result<T>> {
  try {
    const ctx = await getBuildingContext(buildingSlug);
    return await run(ctx);
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

function refresh(buildingSlug: string, alterationId?: string): void {
  revalidatePath(`/b/${buildingSlug}/alterations`);
  revalidatePath(`/b/${buildingSlug}/insurance`);
  revalidatePath(`/b/${buildingSlug}`);
  if (alterationId) {
    revalidatePath(`/b/${buildingSlug}/alterations/${alterationId}`);
  }
}

export async function submitAlterationAction(
  input: SubmitAlterationInput & { buildingSlug: string },
): Promise<Result<{ alterationId: string }>> {
  const { buildingSlug, ...rest } = input;
  const result = await guard(buildingSlug, (ctx) => submitAlteration(ctx, rest));
  if (result.ok) refresh(buildingSlug, result.data.alterationId);
  return result;
}

export async function actOnAlterationAction(input: {
  buildingSlug: string;
  alterationId: string;
  action: ApprovalAction;
  note?: string | null;
  conditions?: string | null;
}): Promise<Result<{ status: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    actOnAlteration(ctx, {
      alterationId: input.alterationId,
      action: input.action,
      note: input.note ?? null,
      conditions: input.conditions ?? null,
    }),
  );
  if (result.ok) refresh(input.buildingSlug, input.alterationId);
  return result;
}

export async function commentAction(input: {
  buildingSlug: string;
  alterationId: string;
  body: string;
  boardOnly?: boolean;
}): Promise<Result<{ commentId: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    commentOnAlteration(ctx, {
      alterationId: input.alterationId,
      body: input.body,
      ...(input.boardOnly === undefined ? {} : { boardOnly: input.boardOnly }),
    }),
  );
  if (result.ok) refresh(input.buildingSlug, input.alterationId);
  return result;
}

export async function recordCertificateAction(
  input: RecordCoiInput & { buildingSlug: string; alterationId?: string | null },
): Promise<Result<{ certificateId: string; obligationId: string }>> {
  const { buildingSlug, alterationId, ...rest } = input;
  const result = await guard(buildingSlug, (ctx) => recordCertificate(ctx, rest));
  if (result.ok) {
    refresh(buildingSlug, alterationId ?? undefined);
    revalidatePath(`/b/${buildingSlug}/compliance`);
  }
  return result;
}

export async function verifyCertificateAction(input: {
  buildingSlug: string;
  certificateId: string;
  verified: boolean;
  note?: string | null;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    verifyCertificate(ctx, {
      certificateId: input.certificateId,
      verified: input.verified,
      note: input.note ?? null,
    }),
  );
  if (result.ok) refresh(input.buildingSlug);
  return result;
}
