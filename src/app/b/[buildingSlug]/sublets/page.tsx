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
              <tr className="border-b border-limestone-deep">
                <th scope="col" className="eyebrow pb-2 pr-4 font-normal">Unit</th>
                <th scope="col" className="eyebrow pb-2 pr-4 font-normal">Subtenant</th>
                <th scope="col" className="eyebrow pb-2 pr-4 text-right font-normal">Term ends</th>
                <th scope="col" className="eyebrow pb-2 text-right font-normal">Fee</th>
              </tr>
            </thead>
            <tbody>
              {sublets.map((sublet) => (
                <tr key={sublet.id} className="ledger-row align-baseline">
                  <td className="py-3 pr-4 font-mono text-xs text-ironwork">
                    {sublet.unit.label}
                  </td>
                  <td className="py-3 pr-4 text-sm text-ironwork">
                    {sublet.subtenantName}
                  </td>
                  <td className="py-3 pr-4 text-right font-mono text-xs whitespace-nowrap text-ironwork">
                    {formatDate(toPlainDate(sublet.termEnd))}
                    <span className="block text-ironwork-faint">
                      {relativeDays(now, toPlainDate(sublet.termEnd))}
                    </span>
                  </td>
                  <td className="py-3 text-right font-mono text-xs text-ironwork-soft">
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
