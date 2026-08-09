"use server";

import { revalidatePath } from "next/cache";
import { getBuildingContext } from "~/lib/auth/current";
import { CapabilityError } from "~/lib/auth/capabilities";
import {
  assignObligation,
  completeObligation,
  confirmAssessment,
  dismissAssessment,
  reassessBuilding,
  reopenObligation,
  waiveObligation,
} from "~/lib/db/scoped/compliance-writes";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import { fail, type Result } from "~/lib/result";

/**
 * Server Actions for the compliance calendar.
 *
 * Each one resolves its own BuildingContext from the session and the slug —
 * never from anything the form posted. A hidden `buildingId` field would be a
 * tenancy hole with a submit button attached.
 *
 * They return typed results rather than throwing, so a form can say what
 * happened. `guard` turns the two things that genuinely are exceptional —
 * no session, no membership, no capability — into results too, because an
 * error boundary is a worse answer than a sentence.
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

function refresh(buildingSlug: string): void {
  revalidatePath(`/b/${buildingSlug}/compliance`);
  revalidatePath(`/b/${buildingSlug}`);
}

export async function confirmRuleAction(input: {
  buildingSlug: string;
  ruleCode: string;
  dueOn?: string | null;
  note?: string | null;
}): Promise<Result<{ obligationId: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    confirmAssessment(ctx, {
      ruleCode: input.ruleCode,
      dueOn: input.dueOn ?? null,
      note: input.note ?? null,
    }),
  );
  if (result.ok) refresh(input.buildingSlug);
  return result;
}

export async function dismissRuleAction(input: {
  buildingSlug: string;
  ruleCode: string;
  note: string;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    dismissAssessment(ctx, { ruleCode: input.ruleCode, note: input.note }),
  );
  if (result.ok) refresh(input.buildingSlug);
  return result;
}

export async function completeObligationAction(input: {
  buildingSlug: string;
  obligationId: string;
  completedOn?: string | null;
  note?: string | null;
}): Promise<Result<{ nextObligationId: string | null; nextDueOn: string | null }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    completeObligation(ctx, {
      obligationId: input.obligationId,
      completedOn: input.completedOn ?? null,
      note: input.note ?? null,
    }),
  );
  if (result.ok) {
    refresh(input.buildingSlug);
    revalidatePath(`/b/${input.buildingSlug}/compliance/${input.obligationId}`);
  }
  return result;
}

export async function waiveObligationAction(input: {
  buildingSlug: string;
  obligationId: string;
  reason: string;
  notApplicable?: boolean;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    waiveObligation(ctx, {
      obligationId: input.obligationId,
      reason: input.reason,
      ...(input.notApplicable === undefined
        ? {}
        : { notApplicable: input.notApplicable }),
    }),
  );
  if (result.ok) {
    refresh(input.buildingSlug);
    revalidatePath(`/b/${input.buildingSlug}/compliance/${input.obligationId}`);
  }
  return result;
}

export async function reopenObligationAction(input: {
  buildingSlug: string;
  obligationId: string;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    reopenObligation(ctx, { obligationId: input.obligationId }),
  );
  if (result.ok) {
    refresh(input.buildingSlug);
    revalidatePath(`/b/${input.buildingSlug}/compliance/${input.obligationId}`);
  }
  return result;
}

export async function assignObligationAction(input: {
  buildingSlug: string;
  obligationId: string;
  membershipId: string | null;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    assignObligation(ctx, {
      obligationId: input.obligationId,
      membershipId: input.membershipId,
    }),
  );
  if (result.ok) {
    refresh(input.buildingSlug);
    revalidatePath(`/b/${input.buildingSlug}/compliance/${input.obligationId}`);
  }
  return result;
}

export async function reassessAction(input: {
  buildingSlug: string;
}): Promise<Result<{ created: number; changed: string[] }>> {
  const result = await guard(input.buildingSlug, (ctx) => reassessBuilding(ctx));
  if (result.ok) refresh(input.buildingSlug);
  return result;
}
