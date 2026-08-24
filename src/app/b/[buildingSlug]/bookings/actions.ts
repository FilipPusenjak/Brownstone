"use server";

import { revalidatePath } from "next/cache";
import type { ResourceKind } from "~/generated/prisma/enums";
import { CapabilityError } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import {
  addResource,
  cancelBooking,
  confirmBooking,
  recordDeposit,
  requestBooking,
  retireResource,
  returnDeposit,
} from "~/lib/db/scoped/booking-writes";
import { parseMoney } from "~/lib/money";
import type { PrerequisiteType } from "~/lib/primitives/prerequisites";
import { fail, type Result } from "~/lib/result";
import { isPlainDate, plainDate } from "~/lib/time";

/**
 * Server Actions for bookings.
 *
 * Each resolves its own context from the session and the slug in the URL. A
 * posted building id would be a tenancy hole with a submit button attached.
 *
 * Note what the request action does *not* accept: a start time. It takes a
 * date, a slot index and a count, and the window is derived from the
 * resource's own hours on the far side. A booking at ten past nine, or one
 * that runs past closing, or one that crosses midnight, is not something this
 * interface can express.
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

function refresh(buildingSlug: string, bookingId?: string): void {
  revalidatePath(`/b/${buildingSlug}/bookings`);
  if (bookingId) revalidatePath(`/b/${buildingSlug}/bookings/${bookingId}`);
}

export async function requestBookingAction(input: {
  buildingSlug: string;
  resourceId: string;
  unitId: string;
  date: string;
  slotIndex: number;
  slots: number;
  note: string;
}): Promise<Result<{ bookingId: string }>> {
  if (!isPlainDate(input.date)) {
    return fail("invalid", "That date could not be read.", {
      date: "Pick the day of the move.",
    });
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    requestBooking(ctx, {
      resourceId: input.resourceId,
      unitId: input.unitId,
      date: plainDate(input.date),
      slotIndex: input.slotIndex,
      slots: input.slots,
      note: input.note.trim() || null,
    }),
  );

  if (result.ok) refresh(input.buildingSlug, result.data.bookingId);
  return result;
}

export async function confirmBookingAction(input: {
  buildingSlug: string;
  bookingId: string;
}): Promise<Result<{ satisfied: boolean; unmet: string[] }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    confirmBooking(ctx, input.bookingId),
  );

  // Refreshed either way: a refused confirmation still writes down what it
  // checked, and that record is the thing the shareholder came to read.
  refresh(input.buildingSlug, input.bookingId);
  return result;
}

export async function cancelBookingAction(input: {
  buildingSlug: string;
  bookingId: string;
  reason: string;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    cancelBooking(ctx, input.bookingId, input.reason.trim() || null),
  );

  if (result.ok) refresh(input.buildingSlug, input.bookingId);
  return result;
}

export async function recordDepositAction(input: {
  buildingSlug: string;
  bookingId: string;
  amount: string;
  receivedOn: string;
  reference: string;
}): Promise<Result<null>> {
  const amount = parseMoney(input.amount);
  if (amount === null) {
    return fail("invalid", "That amount could not be read.", {
      amount: "A figure like 500 or 500.00.",
    });
  }
  if (!isPlainDate(input.receivedOn)) {
    return fail("invalid", "That date could not be read.", {
      receivedOn: "The day the cheque arrived.",
    });
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    recordDeposit(ctx, input.bookingId, {
      amountCents: amount,
      receivedOn: plainDate(input.receivedOn),
      reference: input.reference.trim() || null,
    }),
  );

  if (result.ok) refresh(input.buildingSlug, input.bookingId);
  return result;
}

export async function returnDepositAction(input: {
  buildingSlug: string;
  bookingId: string;
  returnedOn: string;
  withheld: string;
  note: string;
}): Promise<Result<null>> {
  const withheld = input.withheld.trim() ? parseMoney(input.withheld) : 0;
  if (withheld === null) {
    return fail("invalid", "That amount could not be read.", {
      withheld: "A figure like 150, or leave it blank.",
    });
  }
  if (!isPlainDate(input.returnedOn)) {
    return fail("invalid", "That date could not be read.", {
      returnedOn: "The day it went back.",
    });
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    returnDeposit(ctx, input.bookingId, {
      returnedOn: plainDate(input.returnedOn),
      withheldCents: withheld,
      note: input.note.trim() || null,
    }),
  );

  if (result.ok) refresh(input.buildingSlug, input.bookingId);
  return result;
}

export async function addResourceAction(input: {
  buildingSlug: string;
  name: string;
  kind: ResourceKind;
  slotMinutes: number;
  opensMinute: number;
  closesMinute: number;
  prerequisites: Array<{ type: PrerequisiteType; config: Record<string, unknown> }>;
}): Promise<Result<{ resourceId: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    addResource(ctx, {
      name: input.name,
      kind: input.kind,
      slotMinutes: input.slotMinutes,
      opensMinute: input.opensMinute,
      closesMinute: input.closesMinute,
      prerequisites: input.prerequisites,
    }),
  );

  if (result.ok) refresh(input.buildingSlug);
  return result;
}

export async function retireResourceAction(input: {
  buildingSlug: string;
  resourceId: string;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    retireResource(ctx, input.resourceId),
  );

  if (result.ok) refresh(input.buildingSlug);
  return result;
}
