import Link from "next/link";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import {
  currentTurns,
  listFines,
  listRotations,
  turnsPerUnit,
} from "~/lib/db/scoped/duty";
import { listUnits } from "~/lib/db/scoped/units";
import { formatAmount, money } from "~/lib/money";
import { addDays, formatDate, relativeDays, today, toPlainDate } from "~/lib/time";
import { CreateRotation, LogFine, RotationControls, SwapTurns } from "./DutyForms";

/**
 * The duty rotation, and the fines it exists to prevent.
 *
 * The rota and the fine log sit on one page because the useful question is
 * never "whose turn is it" on its own — it is "whose turn was it when we got
 * ticketed", and the two halves of that answer belong next to each other.
 */
export default async function DutyPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const [turns, fines, units, rotations] = await Promise.all([
    currentTurns(ctx, now),
    listFines(ctx),
    listUnits(ctx),
    // All of them, not just the active ones `currentTurns` returns: a summons
    // that arrives in March can belong to a rota paused in February.
    listRotations(ctx),
  ]);

  const labels = new Map(units.map((unit) => [unit.id, unit.label]));
  const mayManage = can(ctx, "duty.manage");
  const unpaid = fines.filter((fine) => !fine.paidOn && !fine.contestedOn);

  return (
    <>
      <PageHeader
        eyebrow="Duty rotation"
        title={
          unpaid.length === 0
            ? "No sanitation summonses outstanding"
            : `${unpaid.length} sanitation ${unpaid.length === 1 ? "summons" : "summonses"} unanswered`
        }
        lede="Whose turn it is to put the bins out, and what it cost when nobody did."
        actions={
          mayManage ? (
            <CreateRotation
              buildingSlug={buildingSlug}
              units={units.map((unit) => ({ id: unit.id, label: unit.label }))}
              defaultStart={addDays(now, 1)}
            />
          ) : null
        }
      />

      {turns.length === 0 ? (
        <EmptyState title="No rotation set up">
          {mayManage
            ? "Set the order once and Co-operator will tell each apartment when their week comes round."
            : "Once the board sets one up, whose week it is will appear here."}
        </EmptyState>
      ) : (
        turns.map(({ rotation, assignments, current, next, generatedThrough }) => {
          const counts = turnsPerUnit(assignments);
          const upcoming = assignments.filter(
            (row) => toPlainDate(row.periodEnd) >= now,
          );

          return (
            <section key={rotation.id} className="mb-10">
              <div className="border-limestone mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2">
                <h2 className="text-ironwork text-lg font-semibold tracking-tight">
                  {rotation.name}
                  {rotation.active ? null : (
                    <span className="text-ironwork-faint ml-2 font-mono text-xs">
                      paused
                    </span>
                  )}
                </h2>
                <p className="text-ironwork-faint font-mono text-[0.6875rem]">
                  every {rotation.periodDays} days · {rotation.unitOrder.length}{" "}
                  apartments
                </p>
              </div>

              {/* ---- Whose week ---- */}
              <div className="sheet mb-4 px-4 py-4">
                {current ? (
                  <>
                    <p className="eyebrow mb-1">This week</p>
                    <p className="text-ironwork text-lg font-medium">
                      {labels.get(current.unitId) ?? "—"}
                    </p>
                    {current.assignment ? (
                      <p className="text-ironwork-soft mt-1 font-mono text-xs">
                        {formatDate(toPlainDate(current.assignment.periodStart))} to{" "}
                        {formatDate(toPlainDate(current.assignment.periodEnd))}
                        {current.assignment.swappedAt &&
                        current.assignment.originalUnitId !== current.unitId
                          ? ` · swapped from ${labels.get(current.assignment.originalUnitId ?? "") ?? "—"}`
                          : ""}
                      </p>
                    ) : (
                      <p className="text-ironwork-faint mt-1 text-xs">
                        Worked out from the order — this turn is not on the rota yet.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="text-ironwork-soft text-sm">
                    The rotation has not started yet.
                  </p>
                )}

                {next ? (
                  <p className="text-ironwork-soft border-limestone mt-3 border-t pt-3 text-sm">
                    Next: <span className="font-mono">{labels.get(next.unitId)}</span>,{" "}
                    {relativeDays(now, toPlainDate(next.periodStart))}
                  </p>
                ) : null}
              </div>

              {/* ---- The order ---- */}
              <ol className="mb-4 flex flex-wrap gap-2">
                {rotation.unitOrder.map((unitId, index) => (
                  <li
                    key={unitId}
                    className={`rounded-chip border px-2 py-0.5 font-mono text-xs ${
                      current?.unitId === unitId
                        ? "border-verdigris bg-verdigris text-white"
                        : "border-limestone-deep text-ironwork"
                    }`}
                  >
                    <span
                      className={
                        current?.unitId === unitId
                          ? "text-white/70"
                          : "text-ironwork-faint"
                      }
                    >
                      {index + 1}.
                    </span>{" "}
                    {labels.get(unitId) ?? "—"}
                    {counts.get(unitId) ? (
                      <span
                        className={
                          current?.unitId === unitId
                            ? "text-white/70"
                            : "text-ironwork-faint"
                        }
                      >
                        {" "}
                        · {counts.get(unitId)} turns
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>

              {generatedThrough ? (
                <p className="text-ironwork-faint mb-4 font-mono text-[0.6875rem]">
                  Rota runs to {formatDate(generatedThrough)}
                </p>
              ) : (
                <p className="text-ironwork-faint mb-4 text-xs">
                  No turns generated yet, so nobody is being reminded.
                </p>
              )}

              <div className="flex flex-wrap gap-4">
                {mayManage ? (
                  <RotationControls
                    buildingSlug={buildingSlug}
                    rotationId={rotation.id}
                    active={rotation.active}
                  />
                ) : null}
              </div>

              {upcoming.length >= 2 ? (
                <div className="mt-4">
                  <SwapTurns
                    buildingSlug={buildingSlug}
                    turns={upcoming.slice(0, 16).map((row) => ({
                      id: row.id,
                      label: `${labels.get(row.unitId) ?? "—"} · ${formatDate(toPlainDate(row.periodStart))}`,
                    }))}
                  />
                </div>
              ) : null}
            </section>
          );
        })
      )}

      {/* ---- Fines ---- */}
      <section className="border-limestone mt-10 border-t pt-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h2 className="text-ironwork text-lg font-semibold tracking-tight">
            Sanitation summonses
          </h2>
          {mayManage ? (
            <LogFine
              buildingSlug={buildingSlug}
              defaultIssuedOn={now}
              rotations={rotations.map((rotation) => ({
                id: rotation.id,
                name: rotation.name,
              }))}
            />
          ) : null}
        </div>

        {fines.length === 0 ? (
          <p className="text-ironwork-soft text-sm">Nothing on record.</p>
        ) : (
          <ul className="divide-limestone border-limestone divide-y border-t">
            {fines.map((fine) => (
              <li key={fine.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Link
                    href={`/b/${buildingSlug}/duty/fines/${fine.id}`}
                    className="text-ironwork hover:text-verdigris text-sm underline-offset-4 hover:underline"
                  >
                    {fine.violation}
                  </Link>
                  <span
                    className={`font-mono text-xs ${
                      fine.paidOn || fine.contestedOn
                        ? "text-ironwork-faint"
                        : "text-stamp"
                    }`}
                  >
                    {formatAmount(money(fine.amountCents))}
                    {fine.paidOn
                      ? " paid"
                      : fine.contestedOn
                        ? " contested"
                        : " unanswered"}
                  </span>
                </div>
                <p className="text-ironwork-faint mt-0.5 font-mono text-[0.6875rem]">
                  {fine.ticketNumber} · {formatDate(toPlainDate(fine.issuedOn))}
                  {fine.unitId
                    ? ` · ${labels.get(fine.unitId) ?? ""}`
                    : " · unattributed"}
                  {fine.hearingOn && !fine.paidOn && !fine.contestedOn
                    ? ` · answer by ${formatDate(toPlainDate(fine.hearingOn))}`
                    : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
