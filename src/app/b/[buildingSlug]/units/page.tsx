import { BuildingElevation } from "~/components/elevation/BuildingElevation";
import { PageHeader } from "~/components/patterns/PageHeader";
import { getBuildingContext } from "~/lib/auth/current";
import { primaryRole } from "~/lib/auth/roles";
import { floorLabel } from "~/lib/building/floors";
import { buildingElevation } from "~/lib/db/scoped/elevation";
import { listMembers, listUnitsWithShares } from "~/lib/db/scoped/units";

/**
 * The share register.
 *
 * Shares are the unit of everything in a co-op — quorum, maintenance, votes —
 * and they are not a column on Unit. Every number here comes from dated
 * ShareAllocation and UnitHolding rows, so this page is the register as of
 * today, and the same query with a past date is the register as it stood then.
 *
 * The elevation on top is the same picture as the overview, and cell width is
 * the share column below it. Two views of one fact.
 */
export default async function UnitsPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const [units, elevation, members] = await Promise.all([
    listUnitsWithShares(ctx),
    buildingElevation(ctx),
    listMembers(ctx),
  ]);

  const totalShares = units.reduce((sum, unit) => sum + unit.shares, 0);

  const membersByUnit = new Map<string, Array<{ name: string; role: string }>>();
  for (const member of members) {
    for (const link of member.units) {
      const existing = membersByUnit.get(link.unitId) ?? [];
      existing.push({
        name: member.user.name ?? member.user.email,
        role: member.title ?? primaryRole(member.roles),
      });
      membersByUnit.set(link.unitId, existing);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Share register"
        title={`${units.length} apartments, ${totalShares.toLocaleString("en-US")} shares`}
        lede="Share counts are dated records, not a field on the apartment. A transfer adds a row; it never overwrites one, so a quorum computed for a meeting three years ago still uses the numbers that applied then."
      />

      <BuildingElevation
        buildingName={ctx.building.name}
        addressLine1={ctx.building.addressLine1}
        floorNaming={ctx.building.floorNaming}
        units={elevation}
      />

      <div className="mt-8 overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Apartments and share allocations for {ctx.building.name}
          </caption>
          <thead>
            <tr className="border-limestone-deep border-b">
              <th scope="col" className="eyebrow pr-4 pb-2 font-normal">
                Apartment
              </th>
              <th
                scope="col"
                className="eyebrow hidden pr-4 pb-2 font-normal sm:table-cell"
              >
                Holder of record
              </th>
              <th scope="col" className="eyebrow pr-4 pb-2 text-right font-normal">
                Shares
              </th>
              <th scope="col" className="eyebrow pb-2 text-right font-normal">
                Share
              </th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => {
              const occupants = membersByUnit.get(unit.id) ?? [];
              const share = totalShares > 0 ? (unit.shares / totalShares) * 100 : 0;

              return (
                <tr
                  key={unit.id}
                  id={unit.label}
                  className="ledger-row scroll-mt-8 align-baseline"
                >
                  <td className="py-3 pr-4">
                    <span className="text-ironwork block text-sm font-medium">
                      {unit.label}
                    </span>
                    <span className="text-ironwork-faint mt-0.5 block font-mono text-[0.6875rem]">
                      {floorLabel(unit.floorIndex, ctx.building.floorNaming)}
                      {unit.line ? ` · line ${unit.line}` : ""}
                      {unit.unitType === "RESIDENTIAL"
                        ? ""
                        : ` · ${unit.unitType.toLowerCase().replaceAll("_", " ")}`}
                    </span>
                  </td>
                  <td className="text-ironwork-soft hidden py-3 pr-4 align-top text-sm sm:table-cell">
                    {unit.holderName ?? "—"}
                    {occupants.length > 0 ? (
                      <span className="text-ironwork-faint mt-0.5 block font-mono text-[0.6875rem]">
                        {occupants
                          .map((occupant) => `${occupant.name} (${occupant.role})`)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </td>
                  <td className="text-ironwork py-3 pr-4 text-right align-top font-mono text-xs whitespace-nowrap">
                    {unit.shares.toLocaleString("en-US")}
                  </td>
                  <td className="text-ironwork-soft py-3 text-right align-top font-mono text-xs whitespace-nowrap">
                    {share.toFixed(1)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-limestone-deep border-t">
              <td className="text-ironwork py-3 pr-4 text-sm font-medium">Total</td>
              <td className="hidden sm:table-cell" />
              <td className="text-ironwork py-3 pr-4 text-right font-mono text-xs">
                {totalShares.toLocaleString("en-US")}
              </td>
              <td className="text-ironwork-soft py-3 text-right font-mono text-xs">
                100.0%
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className="text-ironwork-faint mt-6 max-w-2xl text-xs leading-relaxed">
        Percentages are rounded for display and may not add to exactly 100. Anything
        that depends on shares — quorum, a share-weighted vote, an assessment split — is
        computed from the whole numbers, never from these.
      </p>
    </>
  );
}
