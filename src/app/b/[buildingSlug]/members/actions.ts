"use server";

import { revalidatePath } from "next/cache";
import type { Role } from "~/generated/prisma/enums";
import { CapabilityError } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { inviteMember, revokeInvitation } from "~/lib/db/scoped/member-writes";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import { fail, type Result } from "~/lib/result";

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

export async function inviteMemberAction(input: {
  buildingSlug: string;
  email: string;
  roles: Role[];
  unitIds?: string[];
  note?: string | null;
}): Promise<Result<{ invitationId: string; url: string }>> {
  const { buildingSlug, ...rest } = input;
  const result = await guard(buildingSlug, (ctx) => inviteMember(ctx, rest));
  if (result.ok) revalidatePath(`/b/${buildingSlug}/members`);
  return result;
}

export async function revokeInvitationAction(input: {
  buildingSlug: string;
  invitationId: string;
}): Promise<Result<null>> {
  const result = await guard(input.buildingSlug, (ctx) =>
    revokeInvitation(ctx, input.invitationId),
  );
  if (result.ok) revalidatePath(`/b/${input.buildingSlug}/members`);
  return result;
}
