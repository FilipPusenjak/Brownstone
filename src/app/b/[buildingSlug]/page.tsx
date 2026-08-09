import Link from "next/link";
import { BuildingElevation } from "~/components/elevation/BuildingElevation";
import { PageHeader } from "~/components/patterns/PageHeader";
import { StatusChip } from "~/components/patterns/StatusChip";
import { getBuildingContext } from "~/lib/auth/current";
import { listObligations } from "~/lib/db/scoped/compliance";
import { buildingElevation, overviewCounts } from "~/lib/db/scoped/elevation";
import { dueStatus } from "~/lib/primitives/obligations/recurrence";
import { formatDate, relativeDays, today, toPlainDate } from "~/lib/time";

export default async function BuildingOverview({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const [units, counts, obligations] = await Promise.all([
    buildingElevation(ctx),
    overviewCounts(ctx),
    listObligations(ctx, { state: "OPEN" }),
  ]);

  const next = obligations
    .map((o) => ({ ...o, due: toPlainDate(o.dueOn) }))
    .sort((a, b) => a.due.localeCompare(b.due))
    .slice(0, 5);

  return (
    <>
      <PageHeader
        eyebrow={`${ctx.building.name} · Overview`}
        title={headline(counts.overdue, counts.open)}
        lede={
          counts.proposals > 0
            ? `${counts.proposals} more requirements are waiting for the board to confirm whether they apply to this building.`
            : undefined
        }
      />

      <BuildingElevation
        buildingName={ctx.building.name}
        addressLine1={ctx.building.addressLine1}
        floorNaming={ctx.building.floorNaming}
        units={units}
        hrefFor={(unit) => `/b/${buildingSlug}/units#${unit.label}`}
      />

      <section className="mt-8">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="text-lg font-semibold tracking-tight">What&rsquo;s coming up</h2>
          <Link
            href={`/b/${buildingSlug}/compliance`}
            className="font-mono text-xs text-verdigris underline underline-offset-4"
          >
            All {counts.open} obligations
          </Link>
        </div>

        <ul className="sheet divide-y divide-limestone">
          {next.map((obligation) => {
            const status = dueStatus(
              { state: obligation.state, dueOn: obligation.due },
              now,
            );

            // Stacked on a phone, one row from `sm` up. Squeezing the title and
            // three pieces of metadata onto one narrow line wraps the title a
            // word per line, which is unreadable exactly where it matters most
            // — a board member checking this on the stoop.
            return (
              <li
                key={obligation.id}
                className="px-4 py-3 sm:flex sm:items-baseline sm:gap-x-4"
              >
                <span className="block text-sm font-medium text-ironwork sm:min-w-0 sm:flex-1">
                  {obligation.title}
                </span>
                <span className="mt-1.5 flex items-baseline gap-x-4 sm:mt-0 sm:contents">
                  <span className="font-mono text-xs whitespace-nowrap text-ironwork-soft">
                    {formatDate(obligation.due)}
                  </span>
                  <span className="flex-1 text-xs whitespace-nowrap text-ironwork-faint sm:w-28 sm:flex-none sm:text-right">
                    {relativeDays(now, obligation.due)}
                  </span>
                  <StatusChip status={status} />
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

/**
 * Copy in the words a board member would use out loud, and specific: the number
 * that matters, not "compliance items require attention".
 */
function headline(overdue: number, open: number): string {
  if (overdue === 1) return "1 filing is overdue";
  if (overdue > 1) return `${overdue} filings are overdue`;
  if (open === 0) return "Nothing is due";
  return "Nothing overdue";
}
