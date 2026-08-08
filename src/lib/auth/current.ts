import { cache } from "react";
import type { BuildingContext, MemberBuilding } from "~/lib/db/context";
import {
  NotSignedInError,
  memberBuildings,
  resolveBuildingContext,
} from "~/lib/db/context";
import { auth } from "./config";

/**
 * The request-scoped half of context resolution: who is signed in.
 *
 * Kept apart from `src/lib/db/context.ts` on purpose. That module answers
 * "given a user and a building slug, what may this person see", which is a
 * question about the database and is tested directly against it. This module
 * answers "who is making this request", which is a question about cookies.
 * Keeping the two separate means the tenancy suite never has to stand up an
 * HTTP session to prove a database property.
 */

/** The signed-in user's id, or null. */
export async function sessionUserId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.id ?? null;
}

/**
 * The context for the current request, memoised for the render pass.
 *
 * The memoisation is what makes the context ergonomic: a layout, a page and
 * three components can each ask for it without three round trips, so nobody is
 * tempted to thread it by hand or reach past it. An architecture people route
 * around is not an architecture.
 *
 * Throws rather than returning null — a page rendering without a context is a
 * page leaking data. Callers map the errors onto `redirect()` and `notFound()`.
 */
export const getBuildingContext = cache(
  async (buildingSlug: string): Promise<BuildingContext> => {
    const userId = await sessionUserId();
    if (!userId) throw new NotSignedInError();
    return resolveBuildingContext(userId, buildingSlug);
  },
);

/** Every building the signed-in user belongs to. Powers the switcher. */
export const getMemberBuildings = cache(async (): Promise<MemberBuilding[]> => {
  const userId = await sessionUserId();
  if (!userId) return [];
  return memberBuildings(userId);
});
