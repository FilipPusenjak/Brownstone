import Link from "next/link";
import { PageHeader } from "~/components/patterns/PageHeader";
import { UnverifiedChip } from "~/components/patterns/StatusChip";
import { getBuildingContext } from "~/lib/auth/current";
import { listComplianceRules } from "~/lib/compliance/rules";
import { listAssessments } from "~/lib/db/scoped/compliance";

/**
 * The ruleset, with its citations and its uncertainties on the surface.
 *
 * Every requirement Co-operator knows about, whether or not it applies here,
 * and what this building decided about each. Rules that don't apply are worth
 * showing: a board seeing "does not apply — gross floor area is under 25,000
 * sq ft" learns something a silent omission would never tell them.
 */
export default async function RulesPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const [rules, assessments] = await Promise.all([
    listComplianceRules(),
    listAssessments(ctx),
  ]);

  const byCode = new Map(assessments.map((a) => [a.ruleCode, a]));
  const unverified = rules.filter((r) => r.needsVerification).length;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/b/${buildingSlug}/compliance`}
            className="underline underline-offset-4"
          >
            Compliance calendar
          </Link>
        }
        title="Every requirement we know about"
        lede={`${rules.length} rules, each traceable to the law it comes from. ${unverified} are marked unverified — the requirement is real, but some detail of the deadline or the exemption could not be confirmed. Check those with the agency.`}
      />

      <ul className="divide-y divide-limestone border-t border-limestone">
        {rules.map((rule) => {
          const assessment = byCode.get(rule.code);
          const applies = assessment?.engineVerdict ?? null;

          return (
            <li key={rule.code} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-sm font-medium text-ironwork">{rule.title}</span>
                  {rule.needsVerification ? <UnverifiedChip /> : null}
                </div>
                <span className="font-mono text-[0.6875rem] whitespace-nowrap text-ironwork-faint">
                  {rule.authority} · {rule.code}
                </span>
              </div>

              <p className="mt-1.5 text-sm text-ironwork-soft">{rule.requirement}</p>

              <p className="mt-1.5 font-mono text-[0.6875rem] text-ironwork-faint">
                {rule.citation}
                {rule.sourceUrl ? (
                  <>
                    {" · "}
                    <a
                      href={rule.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-verdigris underline underline-offset-4"
                    >
                      Read it
                    </a>
                  </>
                ) : null}
              </p>

              {assessment ? (
                <p
                  className={`mt-2 font-mono text-[0.6875rem] ${
                    applies ? "text-verdigris" : "text-ironwork-faint"
                  }`}
                >
                  {assessment.engineReason}
                  {assessment.decision !== "PROPOSED" ? (
                    <span className="text-ironwork-faint">
                      {" — "}
                      {assessment.decision === "CONFIRMED"
                        ? "tracked on the calendar"
                        : "the board decided this doesn't apply"}
                    </span>
                  ) : null}
                </p>
              ) : null}

              {rule.needsVerification && rule.verificationNote ? (
                <p className="mt-2 border-l-2 border-brass pl-3 text-xs text-ironwork-soft">
                  {rule.verificationNote}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="mt-8 max-w-2xl text-xs leading-relaxed text-ironwork-faint">
        This list is a starting point for a conversation with the building&rsquo;s
        attorney, not a substitute for one. Requirements change, and Co-operator
        seeds only rules it can cite.
      </p>
    </>
  );
}
