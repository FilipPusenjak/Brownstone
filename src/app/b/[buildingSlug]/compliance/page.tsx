import { PageHeader } from "~/components/patterns/PageHeader";
import { StatusChip, UnverifiedChip } from "~/components/patterns/StatusChip";
import { getBuildingContext } from "~/lib/auth/current";
import { listAssessments, listObligations } from "~/lib/db/scoped/compliance";
import { dueStatus, type DueStatus } from "~/lib/primitives/obligations/recurrence";
import { formatDate, relativeDays, today, toPlainDate } from "~/lib/time";

/**
 * The compliance calendar.
 *
 * A ruled ledger, not a card grid: hairline rules, tabular figures, dates and
 * authorities aligned in mono. The only colour on the page is a status chip,
 * and the only decoration is none.
 */
export default async function CompliancePage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const [obligations, proposals] = await Promise.all([
    listObligations(ctx),
    listAssessments(ctx, { decision: "PROPOSED" }),
  ]);

  const rows = obligations
    .map((o) => {
      const due = toPlainDate(o.dueOn);
      return { ...o, due, status: dueStatus({ state: o.state, dueOn: due }, now) };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.due.localeCompare(b.due));

  const applicable = proposals.filter((p) => p.engineVerdict);

  return (
    <>
      <PageHeader
        eyebrow="Compliance calendar"
        title="What this building owes the city"
        lede="Each item names the law it comes from. Anything marked unverified has a requirement we are confident about and a date we are not — check those against the agency before relying on them."
      />

      <table className="w-full border-collapse text-left">
        <caption className="sr-only">
          Compliance obligations for {ctx.building.name}
        </caption>
        <thead>
          <tr className="border-b border-limestone-deep">
            <th scope="col" className="eyebrow pb-2 pr-4 font-normal">Requirement</th>
            <th scope="col" className="eyebrow hidden pb-2 pr-4 font-normal sm:table-cell">Authority</th>
            <th scope="col" className="eyebrow pb-2 pr-4 text-right font-normal">Due</th>
            <th scope="col" className="eyebrow hidden pb-2 pr-4 text-right font-normal md:table-cell">When</th>
            <th scope="col" className="eyebrow pb-2 text-right font-normal">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="ledger-row align-baseline">
              <td className="py-3 pr-4">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-ironwork">{row.title}</span>
                  {row.needsVerification ? <UnverifiedChip /> : null}
                </div>
                {row.ruleCode ? (
                  <span className="mt-0.5 block font-mono text-[0.6875rem] text-ironwork-faint">
                    {row.ruleCode}
                  </span>
                ) : null}
              </td>
              <td className="hidden py-3 pr-4 font-mono text-xs text-ironwork-soft sm:table-cell">
                {authorityOf(row.ruleCode)}
              </td>
              <td className="py-3 pr-4 text-right font-mono text-xs text-ironwork">
                {formatDate(row.due)}
              </td>
              <td className="hidden py-3 pr-4 text-right text-xs text-ironwork-faint md:table-cell">
                {row.state === "OPEN" ? relativeDays(now, row.due) : "—"}
              </td>
              <td className="py-3 text-right">
                <StatusChip status={row.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {applicable.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">
            Waiting for the board
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ironwork-soft">
            These look like they apply to this building. Nothing goes on the
            calendar until someone confirms it, and a dismissal keeps its reason.
          </p>

          <ul className="mt-4 space-y-3">
            {applicable.map((proposal) => (
              <li key={proposal.id} className="sheet px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-sm font-medium text-ironwork">
                    {proposal.rule.title}
                  </span>
                  <span className="font-mono text-[0.6875rem] text-ironwork-faint">
                    {proposal.rule.citation}
                  </span>
                </div>
                <p className="mt-1.5 text-sm text-ironwork-soft">
                  {proposal.rule.requirement}
                </p>
                <p className="mt-1.5 font-mono text-[0.6875rem] text-verdigris">
                  {proposal.engineReason}
                </p>
                {proposal.rule.needsVerification ? (
                  <p className="mt-1.5 flex flex-wrap items-baseline gap-2 text-xs text-ironwork-faint">
                    <UnverifiedChip />
                    <span className="min-w-0 flex-1">{proposal.rule.verificationNote}</span>
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

/** Sort: what is late first, then what is close, then everything settled. */
const ORDER: Record<DueStatus, number> = {
  OVERDUE: 0,
  DUE_SOON: 1,
  UPCOMING: 2,
  COMPLETED: 3,
  WAIVED: 4,
  NOT_APPLICABLE: 5,
};

function authorityOf(ruleCode: string | null): string {
  if (!ruleCode) return "—";
  const prefix = ruleCode.split("-")[0] ?? "";
  return prefix.toUpperCase();
}
