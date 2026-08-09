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

      <ul className="divide-limestone border-limestone divide-y border-t">
        {rules.map((rule) => {
          const assessment = byCode.get(rule.code);
          const applies = assessment?.engineVerdict ?? null;

          return (
            <li key={rule.code} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-ironwork text-sm font-medium">
                    {rule.title}
                  </span>
                  {rule.needsVerification ? <UnverifiedChip /> : null}
                </div>
                <span className="text-ironwork-faint font-mono text-[0.6875rem] whitespace-nowrap">
                  {rule.authority} · {rule.code}
                </span>
              </div>

              <p className="text-ironwork-soft mt-1.5 text-sm">{rule.requirement}</p>

              <p className="text-ironwork-faint mt-1.5 font-mono text-[0.6875rem]">
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
                <p className="border-brass text-ironwork-soft mt-2 border-l-2 pl-3 text-xs">
                  {rule.verificationNote}
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>

      <p className="text-ironwork-faint mt-8 max-w-2xl text-xs leading-relaxed">
        This list is a starting point for a conversation with the building&rsquo;s
        attorney, not a substitute for one. Requirements change, and Co-operator seeds
        only rules it can cite.
      </p>
    </>
  );
}
