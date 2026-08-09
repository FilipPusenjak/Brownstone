import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { ScaffoldNotice } from "~/components/patterns/ScaffoldNotice";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { listCharges, listPayments } from "~/lib/db/scoped/ledger";
import { listUnits } from "~/lib/db/scoped/units";
import { formatAmount, money } from "~/lib/money";
import { agingByUnit, agingTotals } from "~/lib/primitives/ledger";
import { today, toPlainDate } from "~/lib/time";

export const MISSING = [
  "Posting a charge, and recording a payment",
  "Reversing entries through the interface",
  "Payment plans",
  "Late fee rules",
  "The arrears letter, sent through the notification log",
];

/**
 * Arrears — scaffold.
 *
 * The aging arithmetic is built and tested in `src/lib/primitives/ledger.ts`,
 * including the part that matters: payments apply to the oldest charge first,
 * so a unit paying every month does not sit permanently in the 90-day bucket.
 *
 * The scoping here is the strictest in the product. A shareholder sees their
 * own ledger; only the treasurer and the president see the building's. Which
 * neighbour is behind on maintenance is the most socially explosive fact this
 * system holds.
 */
export default async function ArrearsPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const [charges, payments, units] = await Promise.all([
    listCharges(ctx),
    listPayments(ctx),
    listUnits(ctx),
  ]);

  const labels = new Map(units.map((unit) => [unit.id, unit.label]));
  const seesAll = can(ctx, "arrears.viewAll");

  const rows = agingByUnit(
    charges.map((c) => ({
      id: c.id,
      unitId: c.unitId,
      amountCents: c.amountCents,
      dueOn: toPlainDate(c.dueOn),
      reversesChargeId: c.reversesChargeId,
    })),
    payments.map((p) => ({
      id: p.id,
      unitId: p.unitId,
      amountCents: p.amountCents,
      receivedOn: toPlainDate(p.receivedOn),
      reversesPaymentId: p.reversesPaymentId,
    })),
    now,
  );

  const totals = agingTotals(rows);
  const owing = rows.filter((row) => row.total > 0);

  return (
    <>
      <PageHeader
        eyebrow="Arrears"
        title={
          owing.length === 0
            ? seesAll
              ? "Everyone is up to date"
              : "You're up to date"
            : seesAll
              ? `${owing.length} ${owing.length === 1 ? "unit is" : "units are"} behind`
              : "You have an outstanding balance"
        }
        lede={
          seesAll
            ? "Payments are recorded here, never collected. Co-operator does not touch money."
            : "Your apartment's maintenance account."
        }
      />

      <ScaffoldNotice missing={MISSING} />

      {rows.length === 0 ? (
        <EmptyState title="Nothing on the ledger yet">
          Maintenance charges and the payments against them will appear here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Aged arrears by unit</caption>
            <thead>
              <tr className="border-b border-limestone-deep">
                <th scope="col" className="eyebrow pb-2 pr-4 font-normal">Unit</th>
                <th scope="col" className="eyebrow pb-2 pr-4 text-right font-normal">Current</th>
                <th scope="col" className="eyebrow pb-2 pr-4 text-right font-normal">1–30</th>
                <th scope="col" className="eyebrow pb-2 pr-4 text-right font-normal">31–60</th>
                <th scope="col" className="eyebrow pb-2 pr-4 text-right font-normal">61–90</th>
                <th scope="col" className="eyebrow pb-2 pr-4 text-right font-normal">90+</th>
                <th scope="col" className="eyebrow pb-2 text-right font-normal">Owed</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.unitId} className="ledger-row align-baseline">
                  <td className="py-3 pr-4 font-mono text-xs text-ironwork">
                    {labels.get(row.unitId) ?? "—"}
                  </td>
                  <Amount cents={row.current} />
                  <Amount cents={row.days30} />
                  <Amount cents={row.days60} />
                  <Amount cents={row.days90} />
                  <Amount cents={row.over90} overdue />
                  <td
                    className={`py-3 text-right font-mono text-xs ${
                      row.total > 0 ? "font-medium text-ironwork" : "text-ironwork-faint"
                    }`}
                  >
                    {formatAmount(money(row.total))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-limestone-deep">
                <td className="py-3 pr-4 eyebrow">Total</td>
                <Amount cents={totals.current} />
                <Amount cents={totals.days30} />
                <Amount cents={totals.days60} />
                <Amount cents={totals.days90} />
                <Amount cents={totals.over90} overdue />
                <td className="py-3 text-right font-mono text-xs font-medium text-ironwork">
                  {formatAmount(money(totals.total))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </>
  );
}

function Amount({ cents, overdue }: { cents: number; overdue?: boolean }) {
  return (
    <td
      className={`py-3 pr-4 text-right font-mono text-xs ${
        cents === 0
          ? "text-ironwork-faint"
          : overdue
            ? "text-stamp"
            : "text-ironwork-soft"
      }`}
    >
      {cents === 0 ? "—" : formatAmount(money(cents))}
    </td>
  );
}
