import Link from "next/link";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { buildingLedger, listCharges, listPayments } from "~/lib/db/scoped/ledger";
import { listUnitsWithShares } from "~/lib/db/scoped/units";
import { formatAmount, formatMoney, money } from "~/lib/money";
import { agingByUnit, agingTotals } from "~/lib/primitives/ledger";
import { addMonths, today, toPlainDate } from "~/lib/time";
import { MaintenanceRun } from "./MaintenanceRun";

/**
 * Arrears.
 *
 * The scoping here is the strictest in the product. A shareholder sees their
 * own ledger and nothing else; only the treasurer and the president see the
 * building's. Which neighbour is behind on maintenance is the most socially
 * explosive fact this system holds, and the table below is exactly the thing
 * that must never be shown to the wrong person.
 *
 * Aging comes from `src/lib/primitives/ledger.ts`, where payments apply to the
 * oldest charge first — so a unit paying every month does not sit permanently
 * in the 90-day column, which is both wrong and the sort of thing that starts
 * an argument at a board meeting.
 */
export default async function ArrearsPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const seesAll = can(ctx, "arrears.viewAll");
  const mayPost = can(ctx, "arrears.postCharge");

  // Officers read the whole building in one query; a shareholder's reads are
  // unit-filtered in the scoped layer and never see anyone else's rows.
  const ledger = seesAll
    ? await buildingLedger(ctx)
    : await (async () => {
        const [charges, payments] = await Promise.all([
          listCharges(ctx),
          listPayments(ctx),
        ]);
        return { charges, payments };
      })();

  const units = await listUnitsWithShares(ctx, now);
  const labels = new Map(units.map((unit) => [unit.id, unit.label]));

  const rows = agingByUnit(
    ledger.charges.map((c) => ({
      id: c.id,
      unitId: c.unitId,
      amountCents: c.amountCents,
      dueOn: toPlainDate(c.dueOn),
      reversesChargeId: c.reversesChargeId,
    })),
    ledger.payments.map((p) => ({
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

  // Maintenance is normally posted for the month ahead.
  const nextDue = `${addMonths(now, 1).slice(0, 7)}-01`;

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
              ? `${owing.length} ${owing.length === 1 ? "apartment is" : "apartments are"} behind`
              : "You have an outstanding balance"
        }
        lede={
          seesAll
            ? `${formatMoney(money(totals.total))} outstanding across the building. Payments are recorded here, never collected — Co-operator does not touch money.`
            : "Your apartment's maintenance account."
        }
      />

      {mayPost ? (
        <div className="mb-8">
          <MaintenanceRun
            buildingSlug={buildingSlug}
            units={units.map((unit) => ({
              id: unit.id,
              label: unit.label,
              shares: unit.shares,
            }))}
            defaultDueOn={nextDue}
          />
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title="Nothing on the ledger yet">
          {mayPost
            ? "Post the month's maintenance above, and it will be split across the apartments by share allocation."
            : "Maintenance charges and the payments against them will appear here."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Aged arrears by apartment</caption>
            <thead>
              <tr className="border-limestone-deep border-b">
                <th scope="col" className="eyebrow pr-4 pb-2 font-normal">
                  Apartment
                </th>
                <th scope="col" className="eyebrow pr-4 pb-2 text-right font-normal">
                  Current
                </th>
                <th
                  scope="col"
                  className="eyebrow hidden pr-4 pb-2 text-right font-normal sm:table-cell"
                >
                  1–30
                </th>
                <th
                  scope="col"
                  className="eyebrow hidden pr-4 pb-2 text-right font-normal sm:table-cell"
                >
                  31–60
                </th>
                <th
                  scope="col"
                  className="eyebrow hidden pr-4 pb-2 text-right font-normal sm:table-cell"
                >
                  61–90
                </th>
                <th scope="col" className="eyebrow pr-4 pb-2 text-right font-normal">
                  90+
                </th>
                <th scope="col" className="eyebrow pb-2 text-right font-normal">
                  Owed
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.unitId} className="ledger-row align-baseline">
                  <td className="py-3 pr-4">
                    <Link
                      href={`/b/${buildingSlug}/arrears/${row.unitId}`}
                      className="text-ironwork decoration-limestone-deep hover:decoration-verdigris font-mono text-xs underline underline-offset-4"
                    >
                      {labels.get(row.unitId) ?? "—"}
                    </Link>
                  </td>
                  <Amount cents={row.current} />
                  <Amount cents={row.days30} hideOnMobile />
                  <Amount cents={row.days60} hideOnMobile />
                  <Amount cents={row.days90} hideOnMobile />
                  <Amount cents={row.over90} overdue />
                  <td
                    className={`py-3 text-right font-mono text-xs ${
                      row.total > 0
                        ? "text-ironwork font-medium"
                        : "text-ironwork-faint"
                    }`}
                  >
                    {formatAmount(money(row.total))}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-limestone-deep border-t-2">
                <td className="eyebrow py-3 pr-4">Total</td>
                <Amount cents={totals.current} />
                <Amount cents={totals.days30} hideOnMobile />
                <Amount cents={totals.days60} hideOnMobile />
                <Amount cents={totals.days90} hideOnMobile />
                <Amount cents={totals.over90} overdue />
                <td className="text-ironwork py-3 text-right font-mono text-xs font-medium">
                  {formatAmount(money(totals.total))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <p className="text-ironwork-faint mt-6 max-w-2xl text-xs leading-relaxed">
        Nothing on this ledger is ever edited or deleted. A correction is a reversing
        entry pointing at what it reverses, and the application&rsquo;s database role
        holds no permission to update or delete either table.
      </p>
    </>
  );
}

function Amount({
  cents,
  overdue,
  hideOnMobile,
}: {
  cents: number;
  overdue?: boolean;
  hideOnMobile?: boolean;
}) {
  return (
    <td
      className={`py-3 pr-4 text-right font-mono text-xs ${
        hideOnMobile ? "hidden sm:table-cell" : ""
      } ${
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
