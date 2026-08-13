"use server";

import { revalidatePath } from "next/cache";
import type { ChargeKind, PaymentMethod } from "~/generated/prisma/enums";
import { CapabilityError } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import {
  postCharge,
  postMonthlyMaintenance,
  recordPayment,
  reverseCharge,
  reversePayment,
  type MaintenanceRunResult,
} from "~/lib/db/scoped/ledger-writes";
import { parseMoney } from "~/lib/money";
import { fail, type Result } from "~/lib/result";
import { isPlainDate, plainDate } from "~/lib/time";

/**
 * Ledger actions.
 *
 * Each one resolves its own context from the session and the URL slug. A posted
 * `buildingId` is never trusted — that would make the tenant a form field, and
 * a form field is something anyone can change.
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
      return fail(
        "forbidden",
        "Only the treasurer can post charges and record payments.",
      );
    }
    throw error;
  }
}

/** Money arrives from a text field, so it is parsed here rather than trusted. */
function readAmount(raw: string, field: string): { cents: number } | Result<never> {
  const parsed = parseMoney(raw);
  if (parsed === null) {
    return fail("invalid", "That amount could not be read.", {
      [field]: "Enter an amount like 1,250.00",
    });
  }
  return { cents: parsed };
}

function readDate(raw: string, field: string): { date: string } | Result<never> {
  if (!isPlainDate(raw)) {
    return fail("invalid", "That date could not be read.", {
      [field]: "Pick a date.",
    });
  }
  return { date: raw };
}

export async function postChargeAction(input: {
  buildingSlug: string;
  unitId: string;
  kind: ChargeKind;
  amount: string;
  dueOn: string;
  memo?: string | null;
}): Promise<Result<{ chargeId: string }>> {
  const amount = readAmount(input.amount, "amount");
  if ("ok" in amount) return amount;
  const due = readDate(input.dueOn, "dueOn");
  if ("ok" in due) return due;

  const result = await guard(input.buildingSlug, (ctx) =>
    postCharge(ctx, {
      unitId: input.unitId,
      kind: input.kind,
      amountCents: amount.cents,
      dueOn: plainDate(due.date),
      memo: input.memo ?? null,
    }),
  );

  if (result.ok) revalidateArrears(input.buildingSlug);
  return result;
}

export async function recordPaymentAction(input: {
  buildingSlug: string;
  unitId: string;
  amount: string;
  receivedOn: string;
  method: PaymentMethod;
  reference?: string | null;
  memo?: string | null;
}): Promise<Result<{ paymentId: string }>> {
  const amount = readAmount(input.amount, "amount");
  if ("ok" in amount) return amount;
  const received = readDate(input.receivedOn, "receivedOn");
  if ("ok" in received) return received;

  const result = await guard(input.buildingSlug, (ctx) =>
    recordPayment(ctx, {
      unitId: input.unitId,
      amountCents: amount.cents,
      receivedOn: plainDate(received.date),
      method: input.method,
      reference: input.reference ?? null,
      memo: input.memo ?? null,
    }),
  );

  if (result.ok) revalidateArrears(input.buildingSlug);
  return result;
}

export async function reverseChargeAction(input: {
  buildingSlug: string;
  chargeId: string;
  reason: string;
}): Promise<Result<{ chargeId: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    reverseCharge(ctx, input.chargeId, input.reason),
  );
  if (result.ok) revalidateArrears(input.buildingSlug);
  return result;
}

export async function reversePaymentAction(input: {
  buildingSlug: string;
  paymentId: string;
  reason: string;
}): Promise<Result<{ paymentId: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    reversePayment(ctx, input.paymentId, input.reason),
  );
  if (result.ok) revalidateArrears(input.buildingSlug);
  return result;
}

export async function postMaintenanceAction(input: {
  buildingSlug: string;
  dueOn: string;
  total: string;
  memo?: string | null;
}): Promise<Result<MaintenanceRunResult>> {
  const amount = readAmount(input.total, "total");
  if ("ok" in amount) return amount;
  const due = readDate(input.dueOn, "dueOn");
  if ("ok" in due) return due;

  const result = await guard(input.buildingSlug, (ctx) =>
    postMonthlyMaintenance(ctx, {
      dueOn: plainDate(due.date),
      totalCents: amount.cents,
      memo: input.memo ?? null,
    }),
  );

  if (result.ok) revalidateArrears(input.buildingSlug);
  return result;
}

function revalidateArrears(buildingSlug: string): void {
  revalidatePath(`/b/${buildingSlug}/arrears`);
  // A literal path does not cover the dynamic child, so the per-apartment
  // ledger is revalidated by its route pattern. Without this a treasurer who
  // records a payment sits looking at the balance it was supposed to change.
  revalidatePath("/b/[buildingSlug]/arrears/[unitId]", "page");
  // The overview counts arrears, and the audit trail just gained an entry.
  revalidatePath(`/b/${buildingSlug}`);
  revalidatePath(`/b/${buildingSlug}/audit`);
}
