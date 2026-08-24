"use server";

import { revalidatePath } from "next/cache";
import type { DutyKind } from "~/generated/prisma/enums";
import { CapabilityError } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import {
  chargeFineToUnit,
  createRotation,
  generateTurns,
  logFine,
  setRotationActive,
  swapTurns,
  updateFine,
} from "~/lib/db/scoped/duty-writes";
import { parseMoney } from "~/lib/money";
import { fail, type Result } from "~/lib/result";
import { isPlainDate, plainDate } from "~/lib/time";

/**
 * Server Actions for the duty rotation.
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

export async function createRotationAction(input: {
  buildingSlug: string;
  name: string;
  kind: DutyKind;
  unitOrder: string[];
  startsOn: string;
  periodDays: number;
}): Promise<Result<{ rotationId: string }>> {
  if (!isPlainDate(input.startsOn)) {
    return fail("invalid", "That date could not be read.", {
      startsOn: "Pick the day the first turn begins.",
    });
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    createRotation(ctx, {
      name: input.name,
      kind: input.kind,
      unitOrder: input.unitOrder,
      startsOn: plainDate(input.startsOn),
      periodDays: input.periodDays,
    }),
  );

  if (result.ok) revalidateDuty(input.buildingSlug);
  return result;
}

export async function setRotationActiveAction(input: {
  buildingSlug: string;
  rotationId: string;
  active: boolean;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    setRotationActive(ctx, input.rotationId, input.active),
  );

  if (result.ok) revalidateDuty(input.buildingSlug);
  return result;
}

export async function generateTurnsAction(input: {
  buildingSlug: string;
  rotationId: string;
  count: number;
}): Promise<Result<{ created: number; through: string | null }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    generateTurns(ctx, input.rotationId, { count: input.count }),
  );

  if (result.ok) {
    revalidateDuty(input.buildingSlug);
    // Each turn carries a reminder, which is an obligation on the calendar.
    revalidatePath(`/b/${input.buildingSlug}/compliance`);
  }
  return result;
}

export async function swapTurnsAction(input: {
  buildingSlug: string;
  assignmentId: string;
  withAssignmentId: string;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    swapTurns(ctx, {
      assignmentId: input.assignmentId,
      withAssignmentId: input.withAssignmentId,
    }),
  );

  if (result.ok) revalidateDuty(input.buildingSlug);
  return result;
}

export async function logFineAction(input: {
  buildingSlug: string;
  ticketNumber: string;
  issuedOn: string;
  violation: string;
  amount: string;
  hearingOn?: string | null;
  note?: string | null;
}): Promise<Result<{ fineId: string; attributedUnitId: string | null }>> {
  if (!isPlainDate(input.issuedOn)) {
    return fail("invalid", "That date could not be read.", {
      issuedOn: "The date on the summons.",
    });
  }
  if (input.hearingOn && !isPlainDate(input.hearingOn)) {
    return fail("invalid", "That date could not be read.", {
      hearingOn: "The answer-by date printed on the summons.",
    });
  }

  const amountCents = parseMoney(input.amount);
  if (amountCents === null) {
    return fail("invalid", "That amount could not be read.", {
      amountCents: "Enter the amount on the summons, like 100.00",
    });
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    logFine(ctx, {
      ticketNumber: input.ticketNumber,
      issuedOn: plainDate(input.issuedOn),
      violation: input.violation,
      amountCents,
      hearingOn: input.hearingOn ? plainDate(input.hearingOn) : null,
      note: input.note ?? null,
    }),
  );

  if (result.ok) {
    revalidateDuty(input.buildingSlug);
    revalidatePath(`/b/${input.buildingSlug}/compliance`);
  }
  return result;
}

export async function updateFineAction(input: {
  buildingSlug: string;
  fineId: string;
  paidOn?: string | null;
  contestedOn?: string | null;
  outcome?: string | null;
  note?: string | null;
}): Promise<Result<null>> {
  for (const [field, value] of [
    ["paidOn", input.paidOn],
    ["contestedOn", input.contestedOn],
  ] as const) {
    if (value && !isPlainDate(value)) {
      return fail("invalid", "That date could not be read.", {
        [field]: "Pick a date.",
      });
    }
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    updateFine(ctx, input.fineId, {
      ...(input.paidOn !== undefined
        ? { paidOn: input.paidOn ? plainDate(input.paidOn) : null }
        : {}),
      ...(input.contestedOn !== undefined
        ? { contestedOn: input.contestedOn ? plainDate(input.contestedOn) : null }
        : {}),
      ...(input.outcome !== undefined ? { outcome: input.outcome } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
    }),
  );

  if (result.ok) {
    revalidateDuty(input.buildingSlug);
    revalidatePath(`/b/${input.buildingSlug}/compliance`);
  }
  return result;
}

export async function chargeFineAction(input: {
  buildingSlug: string;
  fineId: string;
  dueOn: string;
  amount?: string | null;
}): Promise<Result<{ chargeId: string }>> {
  if (!isPlainDate(input.dueOn)) {
    return fail("invalid", "That date could not be read.", { dueOn: "Pick a date." });
  }

  let amountCents: number | undefined;
  if (input.amount && input.amount.trim() !== "") {
    const parsed = parseMoney(input.amount);
    if (parsed === null) {
      return fail("invalid", "That amount could not be read.", {
        amountCents: "Enter an amount like 100.00",
      });
    }
    amountCents = parsed;
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    chargeFineToUnit(ctx, input.fineId, {
      dueOn: plainDate(input.dueOn),
      ...(amountCents !== undefined ? { amountCents } : {}),
    }),
  );

  if (result.ok) {
    revalidateDuty(input.buildingSlug);
    // Money just landed on an apartment's ledger.
    revalidatePath(`/b/${input.buildingSlug}/arrears`);
    revalidatePath("/b/[buildingSlug]/arrears/[unitId]", "page");
  }
  return result;
}

function revalidateDuty(buildingSlug: string): void {
  revalidatePath(`/b/${buildingSlug}/duty`);
  // A literal path does not cover dynamic children.
  revalidatePath("/b/[buildingSlug]/duty/fines/[fineId]", "page");
  revalidatePath(`/b/${buildingSlug}/audit`);
}
