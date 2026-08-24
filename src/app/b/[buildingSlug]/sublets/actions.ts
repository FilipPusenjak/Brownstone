"use server";

import { revalidatePath } from "next/cache";
import { CapabilityError } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import {
  actOnSublet,
  applyToSublet,
  commentOnSublet,
  endSublet,
  postSubletFee,
  renewSublet,
} from "~/lib/db/scoped/sublet-writes";
import { parseMoney } from "~/lib/money";
import type { ApprovalAction } from "~/lib/primitives/approvals";
import { fail, type Result } from "~/lib/result";
import { isPlainDate, plainDate } from "~/lib/time";

/**
 * Server Actions for the sublet register.
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

export async function applyToSubletAction(input: {
  buildingSlug: string;
  unitId: string;
  subtenantName: string;
  subtenantContact?: string | null;
  termStart: string;
  termEnd: string;
  fee?: string | null;
  note?: string | null;
}): Promise<Result<{ subletId: string }>> {
  if (!isPlainDate(input.termStart) || !isPlainDate(input.termEnd)) {
    return fail("invalid", "Those dates could not be read.", {
      termStart: "Pick the days the term runs between.",
    });
  }

  let feeCents: number | undefined;
  if (input.fee && input.fee.trim() !== "") {
    const parsed = parseMoney(input.fee);
    if (parsed === null) {
      return fail("invalid", "That fee could not be read.", {
        feeCents: "Enter an amount like 1,200.00, or leave it blank.",
      });
    }
    feeCents = parsed;
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    applyToSublet(ctx, {
      unitId: input.unitId,
      subtenantName: input.subtenantName,
      subtenantContact: input.subtenantContact ?? null,
      termStart: plainDate(input.termStart),
      termEnd: plainDate(input.termEnd),
      ...(feeCents !== undefined ? { feeCents } : {}),
      note: input.note ?? null,
    }),
  );

  if (result.ok) revalidateSublets(input.buildingSlug);
  return result;
}

export async function actOnSubletAction(input: {
  buildingSlug: string;
  subletId: string;
  action: ApprovalAction;
  note?: string | null;
  conditions?: string | null;
}): Promise<Result<{ status: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    actOnSublet(ctx, input.subletId, {
      action: input.action,
      note: input.note ?? null,
      conditions: input.conditions ?? null,
    }),
  );

  if (result.ok) {
    revalidateSublets(input.buildingSlug);
    // Approving puts the term's end on the compliance calendar.
    revalidatePath(`/b/${input.buildingSlug}/compliance`);
  }
  return result;
}

export async function commentOnSubletAction(input: {
  buildingSlug: string;
  subletId: string;
  body: string;
  boardOnly?: boolean;
}): Promise<Result<{ commentId: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    commentOnSublet(ctx, input.subletId, {
      body: input.body,
      boardOnly: input.boardOnly ?? false,
    }),
  );

  if (result.ok) revalidateSublets(input.buildingSlug);
  return result;
}

export async function endSubletAction(input: {
  buildingSlug: string;
  subletId: string;
  endedOn: string;
  reason?: string | null;
}): Promise<Result<null>> {
  if (!isPlainDate(input.endedOn)) {
    return fail("invalid", "That date could not be read.", {
      endedOn: "Pick the day the subtenant left.",
    });
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    endSublet(ctx, input.subletId, {
      endedOn: plainDate(input.endedOn),
      reason: input.reason ?? null,
    }),
  );

  if (result.ok) {
    revalidateSublets(input.buildingSlug);
    revalidatePath(`/b/${input.buildingSlug}/compliance`);
  }
  return result;
}

export async function postSubletFeeAction(input: {
  buildingSlug: string;
  subletId: string;
  amount?: string | null;
  dueOn: string;
  memo?: string | null;
}): Promise<Result<{ chargeId: string }>> {
  if (!isPlainDate(input.dueOn)) {
    return fail("invalid", "That date could not be read.", { dueOn: "Pick a date." });
  }

  let amountCents: number | undefined;
  if (input.amount && input.amount.trim() !== "") {
    const parsed = parseMoney(input.amount);
    if (parsed === null) {
      return fail("invalid", "That amount could not be read.", {
        amountCents: "Enter an amount like 1,200.00",
      });
    }
    amountCents = parsed;
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    postSubletFee(ctx, input.subletId, {
      ...(amountCents !== undefined ? { amountCents } : {}),
      dueOn: plainDate(input.dueOn),
      memo: input.memo ?? null,
    }),
  );

  if (result.ok) {
    revalidateSublets(input.buildingSlug);
    // Money just landed on an apartment's ledger.
    revalidatePath(`/b/${input.buildingSlug}/arrears`);
    revalidatePath("/b/[buildingSlug]/arrears/[unitId]", "page");
  }
  return result;
}

export async function renewSubletAction(input: {
  buildingSlug: string;
  subletId: string;
  termStart?: string | null;
  termEnd: string;
  fee?: string | null;
}): Promise<Result<{ subletId: string }>> {
  if (!isPlainDate(input.termEnd)) {
    return fail("invalid", "That date could not be read.", {
      termEnd: "Pick the day the renewed term ends.",
    });
  }
  if (input.termStart && !isPlainDate(input.termStart)) {
    return fail("invalid", "That date could not be read.", {
      termStart: "Pick the day the renewed term starts.",
    });
  }

  let feeCents: number | undefined;
  if (input.fee && input.fee.trim() !== "") {
    const parsed = parseMoney(input.fee);
    if (parsed === null) {
      return fail("invalid", "That fee could not be read.", {
        feeCents: "Enter an amount like 1,200.00, or leave it blank.",
      });
    }
    feeCents = parsed;
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    renewSublet(ctx, input.subletId, {
      ...(input.termStart ? { termStart: plainDate(input.termStart) } : {}),
      termEnd: plainDate(input.termEnd),
      ...(feeCents !== undefined ? { feeCents } : {}),
    }),
  );

  if (result.ok) revalidateSublets(input.buildingSlug);
  return result;
}

function revalidateSublets(buildingSlug: string): void {
  revalidatePath(`/b/${buildingSlug}/sublets`);
  // A literal path does not cover dynamic children.
  revalidatePath("/b/[buildingSlug]/sublets/[subletId]", "page");
  revalidatePath(`/b/${buildingSlug}/audit`);
}
