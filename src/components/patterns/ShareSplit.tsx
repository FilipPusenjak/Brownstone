import { formatAmount, formatMoney, money } from "~/lib/money";
import { allocateByShares } from "~/lib/primitives/shares";

/**
 * What each apartment's share of a cost comes to.
 *
 * The percentage and the money are shown together on purpose. "You owe
 * $4,180.22" invites an argument; "you hold 209 of 1,200 shares, which is
 * 17.4%, which is $4,180.22" answers it before it starts. A shareholder facing
 * an assessment is entitled to see the arithmetic, not just the conclusion.
 *
 * Amounts come from `allocateByShares` — the same function that writes the real
 * charges — so what is displayed here and what lands on a ledger cannot drift.
 * Percentages are rounded for reading and never used to compute money; the cent
 * that rounding would lose goes to the largest holder instead, which is why the
 * column sums to the total exactly and the percentages may not sum to 100.
 */

export interface SplitHolding {
  readonly unitId: string;
  readonly label: string;
  readonly holderName?: string | null;
  readonly shares: number;
}

export interface SplitLine extends SplitHolding {
  readonly percent: number;
  readonly amountCents: number;
}

export function splitLines(
  holdings: readonly SplitHolding[],
  totalCents: number,
): SplitLine[] {
  const withShares = holdings.filter((holding) => holding.shares > 0);
  const totalShares = withShares.reduce((sum, holding) => sum + holding.shares, 0);
  if (totalShares === 0) return [];

  const allocation = allocateByShares(
    totalCents,
    withShares.map((holding) => ({ unitId: holding.unitId, shares: holding.shares })),
  );

  return withShares.map((holding) => ({
    ...holding,
    percent: (holding.shares / totalShares) * 100,
    amountCents: allocation.get(holding.unitId) ?? 0,
  }));
}

export function ShareSplit({
  holdings,
  totalCents,
  caption,
}: {
  holdings: readonly SplitHolding[];
  totalCents: number;
  caption?: string;
}) {
  const lines = splitLines(holdings, totalCents);
  const totalShares = lines.reduce((sum, line) => sum + line.shares, 0);
  const allocated = lines.reduce((sum, line) => sum + line.amountCents, 0);

  if (lines.length === 0) {
    return (
      <p className="text-ironwork-soft text-sm">
        No apartment has a share allocation, so this cost cannot be split yet. Add share
        allocations on the units page first.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left">
        <caption className="sr-only">{caption ?? "Cost split by shares"}</caption>
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
            <th scope="col" className="eyebrow pr-4 pb-2 text-right font-normal">
              Share
            </th>
            <th scope="col" className="eyebrow pb-2 text-right font-normal">
              Their part
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line) => (
            <tr key={line.unitId} className="ledger-row align-baseline">
              <td className="text-ironwork py-3 pr-4 font-mono text-xs">
                {line.label}
              </td>
              <td className="text-ironwork-soft hidden py-3 pr-4 text-sm sm:table-cell">
                {line.holderName ?? "—"}
              </td>
              <td className="text-ironwork-soft py-3 pr-4 text-right font-mono text-xs">
                {line.shares.toLocaleString("en-US")}
              </td>
              <td className="text-ironwork-soft py-3 pr-4 text-right font-mono text-xs">
                {line.percent.toFixed(1)}%
              </td>
              <td className="text-ironwork py-3 text-right font-mono text-xs font-medium">
                {formatAmount(money(line.amountCents))}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-limestone-deep border-t-2">
            <td className="eyebrow py-3 pr-4">Total</td>
            <td className="hidden sm:table-cell" />
            <td className="text-ironwork py-3 pr-4 text-right font-mono text-xs">
              {totalShares.toLocaleString("en-US")}
            </td>
            <td className="text-ironwork-soft py-3 pr-4 text-right font-mono text-xs">
              100%
            </td>
            <td className="text-ironwork py-3 text-right font-mono text-xs font-medium">
              {formatMoney(money(allocated))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
