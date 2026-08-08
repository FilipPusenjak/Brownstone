import { withUntenantedTx } from "~/lib/db/tx";

/**
 * Reads over the compliance ruleset.
 *
 * Not in `src/lib/db/scoped` because there is nothing to scope: these rows are
 * the law, identical for every co-op in the city, and they carry no
 * `buildingId` and no RLS policy. Keeping them out of the scoped directory
 * preserves that directory's single invariant — everything in it takes a
 * BuildingContext — which is what makes the boundary worth enforcing.
 */

export async function listComplianceRules() {
  return withUntenantedTx((tx) =>
    tx.complianceRule.findMany({ orderBy: [{ authority: "asc" }, { title: "asc" }] }),
  );
}

export async function getComplianceRule(code: string) {
  return withUntenantedTx((tx) => tx.complianceRule.findUnique({ where: { code } }));
}

/** Rules flagged as needing verification, for the unverified-rules view. */
export async function listUnverifiedRules() {
  return withUntenantedTx((tx) =>
    tx.complianceRule.findMany({
      where: { needsVerification: true },
      orderBy: { title: "asc" },
    }),
  );
}
