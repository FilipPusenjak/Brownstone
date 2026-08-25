"use server";

import { sessionUserId } from "~/lib/auth/current";
import {
  foundBuilding,
  type FoundBuildingInput,
  type Founded,
} from "~/lib/db/founding";
import type { Borough } from "~/lib/nyc/address";
import { lookupBuilding, type Lookup } from "~/lib/nyc/lookup";
import { fail, type Result } from "~/lib/result";

/**
 * The two Server Actions behind setting a building up.
 *
 * Both require a session and neither requires a capability, for the reason
 * argued in `src/lib/db/founding.ts`: capabilities come from a membership, and
 * this is the operation that creates the first one.
 */

export async function lookupBuildingAction(input: {
  addressLine1: string;
  borough: Borough;
}): Promise<Result<Lookup>> {
  // Signed-in only. The endpoint is a thin proxy onto a public dataset, but an
  // open one turns this deployment into somebody else's rate limit.
  const userId = await sessionUserId();
  if (!userId) return fail("unauthenticated", "Sign in again.");

  const lookup = await lookupBuilding(input);
  return { ok: true, data: lookup };
}

export async function foundBuildingAction(
  input: FoundBuildingInput,
): Promise<Result<Founded>> {
  const userId = await sessionUserId();
  if (!userId) {
    return fail("unauthenticated", "Your session has expired. Sign in again.");
  }

  return foundBuilding(userId, input);
}
