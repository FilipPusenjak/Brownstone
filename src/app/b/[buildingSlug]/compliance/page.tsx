import Link from "next/link";
import { PageHeader } from "~/components/patterns/PageHeader";
import { StatusChip, UnverifiedChip } from "~/components/patterns/StatusChip";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { draftObligation, type RuleRow } from "~/lib/compliance/generate";
import { listAssessments, listObligations } from "~/lib/db/scoped/compliance";
import { dueStatus, type DueStatus } from "~/lib/primitives/obligations/recurrence";
import { formatDate, relativeDays, today, toPlainDate } from "~/lib/time";
import { ProposalCard, type Proposal } from "./ProposalCard";
import { ReassessButton } from "./ReassessButton";

/**
 * The compliance calendar.
 *
 * A ruled ledger, not a card grid: hairline rules, tabular figures, dates and
 * authorities aligned in mono. The only colour on the page is a status chip.
 *
 * Below it, the review queue — the board confirms what applies before anything
 * joins the calendar above, and a dismissal keeps its reason forever.
 */
export default async function CompliancePage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const [obligations, assessments] = await Promise.all([
    listObligations(ctx),
    listAssessments(ctx),
  ]);

  const rows = obligations
    .map((o) => {
      const due = toPlainDate(o.dueOn);
      return { ...o, due, status: dueStatus({ state: o.state, dueOn: due }, now) };
    })
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.due.localeCompare(b.due));

  const canAssess = can(ctx, "compliance.assess");

  const proposals: Proposal[] = assessments
    .filter((a) => a.decision === "PROPOSED" && a.engineVerdict)
    .map((assessment) => {
      const draft = draftObligation(assessment.rule as unknown as RuleRow, { today: now });
      return {
        ruleCode: assessment.ruleCode,
        title: assessment.rule.title,
        citation: assessment.rule.citation,
        requirement: assessment.rule.requirement,
        engineReason: assessment.engineReason,
        needsVerification: assessment.rule.needsVerification,
        verificationNote: assessment.rule.verificationNote,
        sourceUrl: assessment.rule.sourceUrl,
        needsDateReason: draft.kind === "needsDate" ? draft.reason : null,
        suggestedDueOn: draft.kind === "ready" ? draft.dueOn : null,
      };
    });

  const dismissed = assessments.filter((a) => a.decision === "DISMISSED");

  return (
    <>
      <PageHeader
        eyebrow="Compliance calendar"
        title="What this building owes the city"
        lede="Each item names the law it comes from. Anything marked unverified has a requirement we're confident about and a date we're not — check those against the agency before relying on them."
        actions={canAssess ? <ReassessButton buildingSlug={buildingSlug} /> : undefined}
      />

      {rows.length === 0 ? (
        <div className="sheet px-6 py-10 text-center">
          <p className="text-sm font-medium text-ironwork">
            Nothing on the calendar yet
          </p>
          <p className="mx-auto mt-2 max-w-md text-sm text-ironwork-soft">
            {proposals.length > 0
              ? `${proposals.length} requirements below look like they apply to this building. Confirm the ones that do.`
              : "Check what applies to this building to get started."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
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
                      <Link
                        href={`/b/${buildingSlug}/compliance/${row.id}`}
                        className="text-sm font-medium text-ironwork underline decoration-limestone-deep underline-offset-4 hover:decoration-verdigris"
                      >
                        {row.title}
                      </Link>
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
                  <td className="py-3 pr-4 text-right font-mono text-xs whitespace-nowrap text-ironwork">
                    {formatDate(row.due)}
                  </td>
                  <td className="hidden py-3 pr-4 text-right text-xs whitespace-nowrap text-ironwork-faint md:table-cell">
                    {row.state === "OPEN" ? relativeDays(now, row.due) : "—"}
                  </td>
                  <td className="py-3 text-right">
                    <StatusChip status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {proposals.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">Waiting for the board</h2>
          <p className="mt-1 max-w-2xl text-sm text-ironwork-soft">
            {canAssess
              ? "These look like they apply to this building. Nothing goes on the calendar until someone confirms it, and a dismissal keeps its reason."
              : "These look like they apply to this building. An officer needs to confirm them before they join the calendar."}
          </p>

          <ul className="mt-4 space-y-3">
            {proposals.map((proposal) =>
              canAssess ? (
                <ProposalCard
                  key={proposal.ruleCode}
                  proposal={proposal}
                  buildingSlug={buildingSlug}
                />
              ) : (
                <li key={proposal.ruleCode} className="sheet px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-sm font-medium text-ironwork">
                      {proposal.title}
                    </span>
                    <span className="font-mono text-[0.6875rem] text-ironwork-faint">
                      {proposal.citation}
                    </span>
                  </div>
                  <p className="mt-1.5 text-sm text-ironwork-soft">{proposal.requirement}</p>
                </li>
              ),
            )}
          </ul>
        </section>
      ) : null}

      {dismissed.length > 0 ? (
        <section className="mt-10">
          <h2 className="text-lg font-semibold tracking-tight">
            Decided not to apply
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-ironwork-soft">
            Kept so the next board can see what was decided, by whom, and why.
          </p>

          <ul className="mt-4 divide-y divide-limestone border-t border-limestone">
            {dismissed.map((assessment) => (
              <li key={assessment.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="text-sm text-ironwork">{assessment.rule.title}</span>
                  <span className="font-mono text-[0.6875rem] text-ironwork-faint">
                    {assessment.decidedBy?.user.name ?? "—"}
                    {assessment.decidedAt
                      ? ` · ${formatDate(toPlainDate(assessment.decidedAt))}`
                      : ""}
                  </span>
                </div>
                {assessment.decisionNote ? (
                  <p className="mt-1 text-sm text-ironwork-soft">
                    {assessment.decisionNote}
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
