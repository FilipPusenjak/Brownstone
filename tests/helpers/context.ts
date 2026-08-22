import { resolveBuildingContext, type BuildingContext } from "~/lib/db/context";
import { withUntenantedTx } from "~/lib/db/tx";

/**
 * Test contexts, built through the real resolver.
 *
 * Deliberately not a hand-made object literal. A stubbed context drifts away
 * from the resolver over time, and the day it does, the isolation suite starts
 * proving something about the stub rather than about the application.
 */

export const ADELAIDE = "adelaide";
export const LISPENARD = "lispenard-house";

export const PEOPLE = {
  /** The Adelaide: president. Sees everything in one building. */
  noraPresident: "nora.whitfield@example.com",
  /** The Adelaide: treasurer. The only officer with building-wide arrears. */
  desmondTreasurer: "desmond.achebe@example.com",
  /** The Adelaide: secretary, and shareholder in 3R. Keeps the minutes. */
  priyaSecretary: "priya.raman@example.com",
  /** The Adelaide: plain shareholder in the garden apartment. */
  halShareholder: "hal.brenner@example.com",
  /** Active member of BOTH buildings. The cross-tenant subject. */
  martaBoth: "marta.oyelaran@example.com",
  /** Lispenard House: president. Never a member of The Adelaide. */
  ivanPresident: "ivan.petrosyan@example.com",
  /** Lispenard House: observer. Reads little, changes nothing. */
  rosalindObserver: "rosalind.hyde@example.com",
} as const;

export async function userIdFor(email: string): Promise<string> {
  const user = await withUntenantedTx((tx) =>
    tx.user.findUnique({ where: { email }, select: { id: true } }),
  );
  if (!user) throw new Error(`Seed is missing user ${email}`);
  return user.id;
}

export async function contextFor(
  email: string,
  buildingSlug: string,
): Promise<BuildingContext> {
  return resolveBuildingContext(await userIdFor(email), buildingSlug);
}

/** Both buildings' ids, for asserting that nothing crosses between them. */
export async function buildingIds(): Promise<{ adelaide: string; lispenard: string }> {
  const nora = await contextFor(PEOPLE.noraPresident, ADELAIDE);
  const ivan = await contextFor(PEOPLE.ivanPresident, LISPENARD);
  return { adelaide: nora.building.id, lispenard: ivan.building.id };
}
