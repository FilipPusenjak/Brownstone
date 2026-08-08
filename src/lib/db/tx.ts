import type { Prisma } from "~/generated/prisma/client";
import { prisma } from "./prisma";

/**
 * Transaction wrappers that carry tenant identity into Postgres.
 *
 * Row-level security reads `app.current_building_id` from the session. These
 * helpers are the only things that set it, and they set it with `SET LOCAL`, so
 * the value dies with the transaction and cannot leak into the next request
 * that borrows the same pooled connection.
 *
 * A query issued outside these wrappers has no setting. The RLS predicate then
 * compares against NULL, matches nothing, and returns an empty result. That is
 * deliberate: the failure mode of forgetting the wrapper is an empty page, not
 * another building's data.
 */

/** A Prisma client bound to a transaction that has tenant settings applied. */
export type ScopedTx = Prisma.TransactionClient;

const TX_OPTIONS = {
  maxWait: 5_000,
  timeout: 15_000,
} as const;

/**
 * `SET LOCAL` will not accept a bind parameter, so the value is interpolated.
 * Everything reaching these helpers is a uuid from the database or the session,
 * but "it can't be hostile" is how injection arrives, so it is validated as a
 * uuid before it ever reaches a SQL string.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertUuid(value: string, label: string): string {
  if (!UUID.test(value)) {
    throw new Error(`${label} must be a uuid, received ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Runs `fn` in a transaction scoped to one building.
 *
 * This is the workhorse: every scoped query module funnels through it.
 */
export async function withBuildingTx<T>(
  buildingId: string,
  fn: (tx: ScopedTx) => Promise<T>,
): Promise<T> {
  const id = assertUuid(buildingId, "buildingId");

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_building_id = '${id}'`);
    return fn(tx);
  }, TX_OPTIONS);
}

/**
 * Runs `fn` in a transaction that may read the signed-in user's own membership
 * rows and the buildings those memberships point at — and nothing else.
 *
 * This is the sign-in bootstrap, the single read in the system that crosses
 * tenants, and it is narrow by construction: `member_self` restricts Membership
 * to rows owned by this user, and Building is restricted to ids this callback
 * has already proved membership in via `allowBuildings`.
 */
export interface BootstrapScope {
  /**
   * Widens Building reads to ids the caller has just proved membership in.
   * Pass only ids read from this user's own membership rows.
   */
  allowBuildings(ids: string[]): Promise<void>;
  /**
   * Narrows the rest of the transaction to one building, so the remainder of
   * context resolution — which units this member holds — reads under the same
   * tenant isolation as everything else, in the same round trip.
   */
  enterBuilding(id: string): Promise<void>;
}

export async function withMemberBootstrapTx<T>(
  userId: string,
  fn: (tx: ScopedTx, scope: BootstrapScope) => Promise<T>,
): Promise<T> {
  const id = assertUuid(userId, "userId");

  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.current_user_id = '${id}'`);

    const scope: BootstrapScope = {
      async allowBuildings(ids: string[]): Promise<void> {
        const checked = ids.map((value) => assertUuid(value, "buildingId"));
        await tx.$executeRawUnsafe(
          `SET LOCAL app.member_building_ids = '${checked.join(",")}'`,
        );
      },
      async enterBuilding(buildingId: string): Promise<void> {
        const checked = assertUuid(buildingId, "buildingId");
        await tx.$executeRawUnsafe(
          `SET LOCAL app.current_building_id = '${checked}'`,
        );
      },
    };

    return fn(tx, scope);
  }, TX_OPTIONS);
}

/**
 * Runs `fn` with no tenant setting, for the handful of operations that are
 * genuinely tenant-free: Auth.js session and verification-token tables, the
 * shared compliance ruleset, and invitation redemption, where the whole point
 * is that the caller does not yet belong to the building.
 *
 * None of those tables carry RLS, so this grants nothing extra — it exists to
 * make the intent legible at the call site and greppable in review.
 */
export async function withUntenantedTx<T>(fn: (tx: ScopedTx) => Promise<T>): Promise<T> {
  return prisma.$transaction(async (tx) => fn(tx), TX_OPTIONS);
}
