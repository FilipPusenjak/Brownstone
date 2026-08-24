import Link from "next/link";
import { CapMeter } from "~/components/patterns/CapMeter";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { isActiveOn, isPending, listSublets, subletCap } from "~/lib/db/scoped/sublets";
import { listUnits } from "~/lib/db/scoped/units";
import { formatAmount, money } from "~/lib/money";
import {
  addMonths,
  addYears,
  formatDate,
  relativeDays,
  today,
  toPlainDate,
} from "~/lib/time";
import { ApprovalChip } from "../alterations/ApprovalChip";
import { ApplyToSublet } from "./SubletForms";

/**
 * The sublet register.
 *
 * Two audiences on one page, and the split is deliberate. The cap reading at
 * the top is building-wide and shown to everybody — how much of the corporation
 * is sublet governs whether a shareholder may apply and is the first thing a
 * buyer's lender asks. The register below it is unit-scoped: a shareholder sees
 * their own applications, an officer sees the building's.
 */
export default async function SubletsPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const [sublets, allUnits, cap] = await Promise.all([
    listSublets(ctx),
    listUnits(ctx),
    subletCap(ctx, now),
  ]);

  // A shareholder applies for their own apartment; an officer who already sees
  // the register may file on a neighbour's behalf.
  const units = can(ctx, "sublet.viewAll")
    ? allUnits
    : allUnits.filter((unit) => ctx.unitIds.includes(unit.id));

  const start = addMonths(now, 1);

  return (
    <>
      <PageHeader
        eyebrow="Sublet register"
        title={
          cap.current === 0
            ? "No apartments are sublet"
            : `${cap.current} of ${cap.totalUnits} apartments sublet`
        }
        lede="Most proprietary leases cap how much of the building may be sublet at once, and going over it can cost every shareholder their lender — so the count matters as much as the paperwork."
        actions={
          <ApplyToSublet
            buildingSlug={buildingSlug}
            units={units.map((unit) => ({ id: unit.id, label: unit.label }))}
            defaultStart={start}
            defaultEnd={addYears(start, 1)}
          />
        }
      />

      <CapMeter cap={cap} />

      <section className="mt-8">
        {sublets.length === 0 ? (
          <EmptyState title="Nothing in the register">
            Applications, approved sublets and their fees will appear here.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Sublet register</caption>
              <thead>
                <tr className="border-limestone-deep border-b">
                  <th scope="col" className="eyebrow pr-4 pb-2 font-normal">
                    Apartment
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
                {sublets.map((sublet) => {
                  const running = isActiveOn(sublet, now);
                  const ended = sublet.endedOn !== null;

                  return (
                    <tr key={sublet.id} className="ledger-row align-baseline">
                      <td className="py-3 pr-4">
                        <Link
                          href={`/b/${buildingSlug}/sublets/${sublet.id}`}
                          className="text-ironwork hover:text-verdigris block font-mono text-xs underline-offset-4 hover:underline"
                        >
                          {sublet.unit.label}
                        </Link>
                        <span className="text-ironwork-faint font-mono text-[0.6875rem]">
                          {running
                            ? "in occupation"
                            : ended
                              ? "ended early"
                              : isPending(sublet)
                                ? "awaiting the board"
                                : "not running"}
                        </span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-ironwork block text-sm">
                          {sublet.subtenantName}
                        </span>
                        {sublet.approval ? (
                          <span className="mt-1 inline-block">
                            <ApprovalChip status={sublet.approval.status} />
                          </span>
                        ) : null}
                      </td>
                      <td className="text-ironwork py-3 pr-4 text-right font-mono text-xs whitespace-nowrap">
                        {formatDate(toPlainDate(sublet.endedOn ?? sublet.termEnd))}
                        <span className="text-ironwork-faint block">
                          {sublet.endedOn
                            ? "ended early"
                            : relativeDays(now, toPlainDate(sublet.termEnd))}
                        </span>
                      </td>
                      <td className="text-ironwork-soft py-3 text-right font-mono text-xs">
                        {formatAmount(money(sublet.feeCents))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
