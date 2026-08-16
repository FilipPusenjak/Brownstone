import Link from "next/link";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { listWork } from "~/lib/db/scoped/work";
import { formatMoney, money } from "~/lib/money";
import { formatDate, toPlainDate } from "~/lib/time";
import { AddWorkForm } from "./WorkForms";

/**
 * Building work.
 *
 * What the building has to spend money on, and what each apartment's share of
 * it comes to. Building-wide on purpose: a shareholder about to be assessed for
 * a roof is entitled to see the estimate and the split without asking anyone.
 */

const STATUS_LABEL: Record<string, string> = {
  PROPOSED: "Proposed",
  APPROVED: "Approved",
  IN_PROGRESS: "In progress",
  COMPLETE: "Complete",
  CANCELLED: "Cancelled",
};

export default async function WorkPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const work = await listWork(ctx);
  const mayManage = can(ctx, "work.manage");

  const live = work.filter(
    (item) => item.status !== "COMPLETE" && item.status !== "CANCELLED",
  );
  const planned = live.reduce((sum, item) => sum + (item.estimateCents ?? 0), 0);

  return (
    <>
      <PageHeader
        eyebrow="Building work"
        title={
          live.length === 0
            ? "Nothing on the list"
            : `${live.length} ${live.length === 1 ? "job" : "jobs"} on the list`
        }
        lede={
          planned > 0
            ? `${formatMoney(money(planned))} of work planned or under way. Open one to see what each apartment's share comes to.`
            : "What the building needs doing, what it will cost, and how that splits across the apartments by shares."
        }
        actions={mayManage ? <AddWorkForm buildingSlug={buildingSlug} /> : undefined}
      />

      {work.length === 0 ? (
        <EmptyState title="No work recorded">
          {mayManage
            ? "Add the roof, the boiler, the parapet — anything the building has to pay for. Record what it's expected to cost and everyone can see their share of it."
            : "When the board records work the building needs, it will appear here with each apartment's share of the cost."}
        </EmptyState>
      ) : (
        <ul className="divide-limestone divide-y">
          {work.map((item) => (
            <li key={item.id} className="py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <Link
                    href={`/b/${buildingSlug}/work/${item.id}`}
                    className="text-ironwork decoration-limestone-deep hover:decoration-verdigris text-sm font-medium underline underline-offset-4"
                  >
                    {item.title}
                  </Link>
                  <span className="text-ironwork-faint mt-0.5 flex flex-wrap gap-x-2 font-mono text-[0.6875rem]">
                    <span>{STATUS_LABEL[item.status] ?? item.status}</span>
                    {item.obligation ? (
                      <span className="text-verdigris">
                        from {item.obligation.title}
                      </span>
                    ) : null}
                    {item.assessmentRaisedAt ? (
                      <span className="text-complete">assessment raised</span>
                    ) : null}
                  </span>
                </div>

                <div className="text-right">
                  <span className="text-ironwork block font-mono text-xs whitespace-nowrap">
                    {item.estimateCents
                      ? formatMoney(money(item.estimateCents))
                      : "no estimate yet"}
                  </span>
                  {item.assessmentDueOn ? (
                    <span className="text-ironwork-faint mt-0.5 block font-mono text-[0.6875rem] whitespace-nowrap">
                      due {formatDate(toPlainDate(item.assessmentDueOn))}
                    </span>
                  ) : null}
                </div>
              </div>

              {item.detail ? (
                <p className="text-ironwork-soft mt-1.5 max-w-2xl text-sm">
                  {item.detail}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
