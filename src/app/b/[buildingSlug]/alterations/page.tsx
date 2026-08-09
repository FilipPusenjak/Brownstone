import Link from "next/link";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { listAlterations } from "~/lib/db/scoped/alterations";
import { formatDate, toPlainDate } from "~/lib/time";
import { ApprovalChip } from "./ApprovalChip";

export default async function AlterationsPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const alterations = await listAlterations(ctx);

  const seesAll = can(ctx, "alteration.viewAll");
  const waiting = alterations.filter((a) =>
    ["SUBMITTED", "UNDER_REVIEW"].includes(a.approval.status),
  );

  return (
    <>
      <PageHeader
        eyebrow="Alterations"
        title={
          waiting.length === 0
            ? "Nothing waiting on the board"
            : waiting.length === 1
              ? "1 request waiting on the board"
              : `${waiting.length} requests waiting on the board`
        }
        lede={
          seesAll
            ? "Every renovation request in the building, and the decision recorded against it."
            : "Renovation requests for your apartment."
        }
        actions={
          <Link
            href={`/b/${buildingSlug}/alterations/new`}
            className="inline-flex items-center rounded-sheet border border-verdigris bg-verdigris px-3.5 py-2 text-sm font-medium text-white hover:bg-verdigris/90"
          >
            File a request
          </Link>
        }
      />

      {alterations.length === 0 ? (
        <EmptyState title="No alteration requests yet">
          Anything that changes plumbing, walls or the riser needs the
          board&rsquo;s approval before work starts.{" "}
          <Link
            href={`/b/${buildingSlug}/alterations/new`}
            className="text-verdigris underline underline-offset-4"
          >
            File a request
          </Link>
          .
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Alteration requests</caption>
            <thead>
              <tr className="border-b border-limestone-deep">
                <th scope="col" className="eyebrow pb-2 pr-4 font-normal">Work</th>
                <th scope="col" className="eyebrow pb-2 pr-4 font-normal">Unit</th>
                <th scope="col" className="eyebrow hidden pb-2 pr-4 font-normal md:table-cell">Contractor</th>
                <th scope="col" className="eyebrow hidden pb-2 pr-4 text-right font-normal sm:table-cell">Filed</th>
                <th scope="col" className="eyebrow pb-2 text-right font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {alterations.map((alteration) => {
                const lapsedCoi = alteration.certificates.some(
                  (c) => !c.additionalInsuredVerified,
                );

                return (
                  <tr key={alteration.id} className="ledger-row align-baseline">
                    <td className="py-3 pr-4">
                      <Link
                        href={`/b/${buildingSlug}/alterations/${alteration.id}`}
                        className="text-sm font-medium text-ironwork underline decoration-limestone-deep underline-offset-4 hover:decoration-verdigris"
                      >
                        {alteration.title}
                      </Link>
                      <span className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[0.6875rem] text-ironwork-faint">
                        {alteration.wetOverDry ? <span>wet over dry</span> : null}
                        {alteration.affectsRiser ? <span>riser</span> : null}
                        {alteration.requiresDobPermit ? <span>DOB permit</span> : null}
                        {alteration.certificates.length === 0 ? (
                          <span className="text-stamp">no insurance on file</span>
                        ) : lapsedCoi ? (
                          <span className="text-stamp">
                            corporation not named as additional insured
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-xs text-ironwork">
                      {alteration.unit.label}
                    </td>
                    <td className="hidden py-3 pr-4 text-sm text-ironwork-soft md:table-cell">
                      {alteration.contractorName ?? "—"}
                    </td>
                    <td className="hidden py-3 pr-4 text-right font-mono text-xs whitespace-nowrap text-ironwork-soft sm:table-cell">
                      {alteration.approval.submittedAt
                        ? formatDate(toPlainDate(alteration.approval.submittedAt))
                        : "draft"}
                    </td>
                    <td className="py-3 text-right">
                      <ApprovalChip status={alteration.approval.status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
