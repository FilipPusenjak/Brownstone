import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { ScaffoldNotice } from "~/components/patterns/ScaffoldNotice";
import { getBuildingContext } from "~/lib/auth/current";
import {
  listDsnyFines,
  listDutyAssignments,
  listDutyRotations,
} from "~/lib/db/scoped/modules";
import { listUnits } from "~/lib/db/scoped/units";
import { formatAmount, money } from "~/lib/money";
import { formatDate, toPlainDate } from "~/lib/time";

export const MISSING = [
  "Generating the rotation as obligations, so reminders go out",
  "Swapping turns between neighbours",
  "Logging a DSNY fine against whoever had the week",
];

/**
 * Duty rotation — scaffold.
 *
 * Trash set-out is the most mundane thing in the product and the most likely to
 * generate a fine, which is why the rotation and the fine log sit on one page:
 * the useful question is not "whose turn is it" but "whose turn was it when we
 * got ticketed".
 */
export default async function DutyPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const [rotations, assignments, fines, units] = await Promise.all([
    listDutyRotations(ctx),
    listDutyAssignments(ctx),
    listDsnyFines(ctx),
    listUnits(ctx),
  ]);

  const labels = new Map(units.map((unit) => [unit.id, unit.label]));
  const unpaid = fines.filter((fine) => !fine.paidOn);

  return (
    <>
      <PageHeader
        eyebrow="Duty rotation"
        title={
          unpaid.length === 0
            ? "No outstanding sanitation fines"
            : `${unpaid.length} unpaid sanitation ${unpaid.length === 1 ? "fine" : "fines"}`
        }
        lede="Whose turn it is to put the bins out, and what it cost when nobody did."
      />

      <ScaffoldNotice missing={MISSING} />

      {rotations.length === 0 ? (
        <EmptyState title="No rotation set up">
          Set the order once and Co-operator will tell each apartment when their
          week comes round.
        </EmptyState>
      ) : (
        rotations.map((rotation) => (
          <section key={rotation.id} className="mb-8">
            <h2 className="mb-1 text-lg font-semibold tracking-tight">
              {rotation.name}
            </h2>
            <p className="mb-3 font-mono text-[0.6875rem] text-ironwork-faint">
              every {rotation.periodDays} days, in order
            </p>
            <ol className="flex flex-wrap gap-2">
              {rotation.unitOrder.map((unitId, index) => (
                <li
                  key={unitId}
                  className="rounded-chip border border-limestone-deep px-2 py-0.5 font-mono text-xs text-ironwork"
                >
                  <span className="text-ironwork-faint">{index + 1}.</span>{" "}
                  {labels.get(unitId) ?? "—"}
                </li>
              ))}
            </ol>

            {assignments.length > 0 ? (
              <p className="mt-3 text-sm text-ironwork-soft">
                This period:{" "}
                <span className="font-mono">
                  {labels.get(assignments[0]?.unitId ?? "") ?? "—"}
                </span>
              </p>
            ) : null}
          </section>
        ))
      )}

      <section>
        <h2 className="mb-3 text-lg font-semibold tracking-tight">
          Sanitation fines
        </h2>
        {fines.length === 0 ? (
          <p className="text-sm text-ironwork-soft">No fines on record.</p>
        ) : (
          <ul className="divide-y divide-limestone border-t border-limestone">
            {fines.map((fine) => (
              <li key={fine.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-sm text-ironwork">{fine.violation}</span>
                  <span
                    className={`font-mono text-xs ${fine.paidOn ? "text-ironwork-faint" : "text-stamp"}`}
                  >
                    {formatAmount(money(fine.amountCents))}
                    {fine.paidOn ? " paid" : " unpaid"}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[0.6875rem] text-ironwork-faint">
                  {fine.ticketNumber} · {formatDate(toPlainDate(fine.issuedOn))}
                  {fine.unitId ? ` · ${labels.get(fine.unitId) ?? ""}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
