import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { ScaffoldNotice } from "~/components/patterns/ScaffoldNotice";
import { getBuildingContext } from "~/lib/auth/current";
import { listSublets } from "~/lib/db/scoped/modules";
import { listUnits } from "~/lib/db/scoped/units";
import { formatAmount, money } from "~/lib/money";
import { formatDate, relativeDays, today, toPlainDate } from "~/lib/time";

export const MISSING = [
  "Applying to sublet, through the approval workflow",
  "Enforcing the building-wide cap at approval",
  "Sublet fees posted to the ledger",
  "Renewal, and the expiry reminder",
];

export default async function SubletsPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const [sublets, units] = await Promise.all([listSublets(ctx), listUnits(ctx)]);
  const active = sublets.filter((s) => toPlainDate(s.termEnd) >= now);

  return (
    <>
      <PageHeader
        eyebrow="Sublet register"
        title={
          active.length === 0
            ? "No units are sublet"
            : `${active.length} of ${units.length} units sublet`
        }
        lede="Most proprietary leases cap how much of the building may be sublet at once, so the count matters as much as the paperwork."
      />

      <ScaffoldNotice missing={MISSING} />

      {sublets.length === 0 ? (
        <EmptyState title="Nothing in the register">
          Approved sublets, their terms and their fees will appear here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Sublet register</caption>
            <thead>
              <tr className="border-limestone-deep border-b">
                <th scope="col" className="eyebrow pr-4 pb-2 font-normal">
                  Unit
                </th>
                <th scope="col" className="eyebrow pr-4 pb-2 font-normal">
                  Subtenant
                </th>
                <th scope="col" className="eyebrow pr-4 pb-2 text-right font-normal">
                  Term ends
                </th>
                <th scope="col" className="eyebrow pb-2 text-right font-normal">
                  Fee
                </th>
              </tr>
            </thead>
            <tbody>
              {sublets.map((sublet) => (
                <tr key={sublet.id} className="ledger-row align-baseline">
                  <td className="text-ironwork py-3 pr-4 font-mono text-xs">
                    {sublet.unit.label}
                  </td>
                  <td className="text-ironwork py-3 pr-4 text-sm">
                    {sublet.subtenantName}
                  </td>
                  <td className="text-ironwork py-3 pr-4 text-right font-mono text-xs whitespace-nowrap">
                    {formatDate(toPlainDate(sublet.termEnd))}
                    <span className="text-ironwork-faint block">
                      {relativeDays(now, toPlainDate(sublet.termEnd))}
                    </span>
                  </td>
                  <td className="text-ironwork-soft py-3 text-right font-mono text-xs">
                    {formatAmount(money(sublet.feeCents))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
