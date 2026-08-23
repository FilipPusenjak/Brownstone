"use server";

import { revalidatePath } from "next/cache";
import type {
  Responsibility,
  TicketPriority,
  TicketStatus,
} from "~/generated/prisma/enums";
import { CapabilityError } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import {
  chargeTicketToUnit,
  commentOnTicket,
  decideResponsibility,
  openDetermination,
  reportTicket,
  resolveTicket,
  setTicketStatus,
  triageTicket,
} from "~/lib/db/scoped/ticket-writes";
import { parseMoney } from "~/lib/money";
import type { ApprovalAction } from "~/lib/primitives/approvals";
import { fail, type Result } from "~/lib/result";
import { isPlainDate, plainDate } from "~/lib/time";

/**
 * Server Actions for repair tickets.
 *
 * Each resolves its own context from the session and the URL slug. A posted
 * building id would be a tenancy hole with a submit button attached.
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

export async function reportTicketAction(input: {
  buildingSlug: string;
  title: string;
  detail: string;
  unitId?: string | null;
  area?: string | null;
  priority?: TicketPriority;
}): Promise<Result<{ ticketId: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    reportTicket(ctx, {
      title: input.title,
      detail: input.detail,
      unitId: input.unitId || null,
      area: input.area || null,
      ...(input.priority ? { priority: input.priority } : {}),
    }),
  );

  if (result.ok) revalidateTickets(input.buildingSlug);
  return result;
}

export async function triageTicketAction(input: {
  buildingSlug: string;
  ticketId: string;
  assigneeId?: string | null;
  vendorName?: string | null;
  vendorPhone?: string | null;
  priority?: TicketPriority;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    triageTicket(ctx, input.ticketId, {
      ...(input.assigneeId !== undefined
        ? { assigneeId: input.assigneeId || null }
        : {}),
      ...(input.vendorName !== undefined ? { vendorName: input.vendorName } : {}),
      ...(input.vendorPhone !== undefined ? { vendorPhone: input.vendorPhone } : {}),
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
    }),
  );

  if (result.ok) revalidateTickets(input.buildingSlug);
  return result;
}

export async function setTicketStatusAction(input: {
  buildingSlug: string;
  ticketId: string;
  status: TicketStatus;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    setTicketStatus(ctx, input.ticketId, input.status),
  );

  if (result.ok) revalidateTickets(input.buildingSlug);
  return result;
}

export async function resolveTicketAction(input: {
  buildingSlug: string;
  ticketId: string;
  note: string;
  cost?: string | null;
}): Promise<Result<null>> {
  let costCents: number | null = null;
  if (input.cost && input.cost.trim() !== "") {
    const parsed = parseMoney(input.cost);
    if (parsed === null) {
      return fail("invalid", "That cost could not be read.", {
        costCents: "Enter an amount like 350.00, or leave it blank.",
      });
    }
    costCents = parsed;
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    resolveTicket(ctx, input.ticketId, { note: input.note, costCents }),
  );

  if (result.ok) revalidateTickets(input.buildingSlug);
  return result;
}

export async function openDeterminationAction(input: {
  buildingSlug: string;
  ticketId: string;
  question?: string | null;
}): Promise<Result<{ approvalRequestId: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    openDetermination(ctx, input.ticketId, { question: input.question ?? null }),
  );

  if (result.ok) revalidateTickets(input.buildingSlug);
  return result;
}

export async function decideResponsibilityAction(input: {
  buildingSlug: string;
  ticketId: string;
  action: ApprovalAction;
  responsibility?: Responsibility;
  note?: string | null;
  conditions?: string | null;
}): Promise<Result<{ status: string; responsibility: Responsibility }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    decideResponsibility(ctx, input.ticketId, {
      action: input.action,
      ...(input.responsibility ? { responsibility: input.responsibility } : {}),
      note: input.note ?? null,
      conditions: input.conditions ?? null,
    }),
  );

  if (result.ok) revalidateTickets(input.buildingSlug);
  return result;
}

export async function commentOnTicketAction(input: {
  buildingSlug: string;
  ticketId: string;
  body: string;
  boardOnly?: boolean;
}): Promise<Result<{ commentId: string }>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    commentOnTicket(ctx, input.ticketId, {
      body: input.body,
      boardOnly: input.boardOnly ?? false,
    }),
  );

  if (result.ok) revalidateTickets(input.buildingSlug);
  return result;
}

export async function chargeTicketAction(input: {
  buildingSlug: string;
  ticketId: string;
  amount: string;
  dueOn: string;
  memo?: string | null;
}): Promise<Result<{ chargeId: string }>> {
  const amountCents = parseMoney(input.amount);
  if (amountCents === null) {
    return fail("invalid", "That amount could not be read.", {
      amountCents: "Enter an amount like 350.00",
    });
  }
  if (!isPlainDate(input.dueOn)) {
    return fail("invalid", "That date could not be read.", { dueOn: "Pick a date." });
  }

  const result = await guard(input.buildingSlug, (ctx) =>
    chargeTicketToUnit(ctx, input.ticketId, {
      amountCents,
      dueOn: plainDate(input.dueOn),
      memo: input.memo ?? null,
    }),
  );

  if (result.ok) {
    revalidateTickets(input.buildingSlug);
    // Money just landed on an apartment's ledger.
    revalidatePath(`/b/${input.buildingSlug}/arrears`);
    revalidatePath("/b/[buildingSlug]/arrears/[unitId]", "page");
  }
  return result;
}

function revalidateTickets(buildingSlug: string): void {
  revalidatePath(`/b/${buildingSlug}/tickets`);
  // A literal path does not cover dynamic children.
  revalidatePath("/b/[buildingSlug]/tickets/[ticketId]", "page");
  revalidatePath(`/b/${buildingSlug}/audit`);
}
