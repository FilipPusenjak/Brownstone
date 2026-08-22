"use server";

import { revalidatePath } from "next/cache";
import type { WorkStatus } from "~/generated/prisma/enums";
import { CapabilityError } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import {
  createWork,
  raiseAssessment,
  recordDecision,
  updateWork,
  type RaiseAssessmentResult,
} from "~/lib/db/scoped/work-writes";
import { parseMoney } from "~/lib/money";
import { fail, type Result } from "~/lib/result";
import { isPlainDate, plainDate } from "~/lib/time";

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

export async function createWorkAction(input: {
  buildingSlug: string;
  title: string;
  detail?: string | null;
  estimate?: string | null;
  obligationId?: string | null;
}): Promise<Result<{ workId: string }>> {
  let estimateCents: number | null = null;
  if (input.estimate && input.estimate.trim() !== "") {
    const parsed = parseMoney(input.estimate);
    if (parsed === null) {
      return fail("invalid", "That estimate could not be read.", {
        estimate: "Enter an amount like 42,000.00",
      });
    }
    estimateCents = parsed;
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    createWork(ctx, {
      title: input.title,
      detail: input.detail ?? null,
      estimateCents,
      obligationId: input.obligationId ?? null,
    }),
  );

  if (result.ok) revalidateWork(input.buildingSlug);
  return result;
}

export async function updateWorkAction(input: {
  buildingSlug: string;
  workId: string;
  estimate?: string | null;
  status?: WorkStatus;
}): Promise<Result<null>> {
  let estimateCents: number | undefined;
  if (input.estimate !== undefined && input.estimate !== null) {
    const parsed = parseMoney(input.estimate);
    if (parsed === null) {
      return fail("invalid", "That estimate could not be read.", {
        estimate: "Enter an amount like 42,000.00",
      });
    }
    estimateCents = parsed;
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    updateWork(ctx, input.workId, {
      ...(estimateCents !== undefined ? { estimateCents } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
    }),
  );

  if (result.ok) revalidateWork(input.buildingSlug);
  return result;
}

export async function recordDecisionAction(input: {
  buildingSlug: string;
  workId: string;
  decidedOn: string;
  votesFor: number;
  votesAgainst: number;
  votesAbstain?: number;
  note?: string | null;
  meetingId?: string | null;
}): Promise<Result<{ carried: boolean }>> {
  if (!isPlainDate(input.decidedOn)) {
    return fail("invalid", "That date could not be read.", {
      decidedOn: "Pick the date the board decided.",
    });
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    recordDecision(ctx, input.workId, {
      decidedOn: plainDate(input.decidedOn),
      votesFor: input.votesFor,
      votesAgainst: input.votesAgainst,
      votesAbstain: input.votesAbstain ?? 0,
      note: input.note ?? null,
      meetingId: input.meetingId || null,
    }),
  );

  if (result.ok) {
    revalidateWork(input.buildingSlug);
    // The meeting page lists the decisions taken at it.
    revalidatePath("/b/[buildingSlug]/meetings/[meetingId]", "page");
  }
  return result;
}

export async function raiseAssessmentAction(input: {
  buildingSlug: string;
  workId: string;
  dueOn: string;
  total?: string | null;
}): Promise<Result<RaiseAssessmentResult>> {
  if (!isPlainDate(input.dueOn)) {
    return fail("invalid", "That date could not be read.", { dueOn: "Pick a date." });
  }

  let totalCents: number | undefined;
  if (input.total && input.total.trim() !== "") {
    const parsed = parseMoney(input.total);
    if (parsed === null) {
      return fail("invalid", "That amount could not be read.", {
        total: "Enter an amount like 42,000.00",
      });
    }
    totalCents = parsed;
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    raiseAssessment(ctx, input.workId, {
      dueOn: plainDate(input.dueOn),
      ...(totalCents !== undefined ? { totalCents } : {}),
    }),
  );

  if (result.ok) {
    revalidateWork(input.buildingSlug);
    // Money just landed on every apartment's ledger.
    revalidatePath(`/b/${input.buildingSlug}/arrears`);
    revalidatePath("/b/[buildingSlug]/arrears/[unitId]", "page");
  }
  return result;
}

function revalidateWork(buildingSlug: string): void {
  revalidatePath(`/b/${buildingSlug}/work`);
  revalidatePath("/b/[buildingSlug]/work/[workId]", "page");
  revalidatePath("/b/[buildingSlug]/compliance/[obligationId]", "page");
  revalidatePath(`/b/${buildingSlug}/audit`);
}
