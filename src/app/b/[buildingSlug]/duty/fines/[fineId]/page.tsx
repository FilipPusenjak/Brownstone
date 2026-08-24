import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { getFine, liveCharges } from "~/lib/db/scoped/duty";
import { formatAmount, formatMoney, money } from "~/lib/money";
import { addMonths, formatDate, relativeDays, today, toPlainDate } from "~/lib/time";
import { AnswerFine, ChargeFine } from "../../DutyForms";

/**
 * One sanitation summons.
 *
 * Ordered by what the board has to do about it: whose week it was, then whether
 * it has been answered, then who pays. The attribution comes first because it
 * is the fact everything else rests on, and because it is the one the summons
 * itself does not tell you.
 */
export default async function FineDetailPage({
  params,
}: {
  params: Promise<{ buildingSlug: string; fineId: string }>;
}) {
  const { buildingSlug, fineId } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const fine = await getFine(ctx, fineId);
  if (!fine) notFound();

  const now = today(ctx.building.timezone);
  const mayManage = can(ctx, "duty.manage");
  const mayBill = can(ctx, "arrears.postCharge");

  const answered = Boolean(fine.paidOn ?? fine.contestedOn);
  const charges = liveCharges(fine.charges);
  const swapped =
    fine.dutyAssignment?.originalUnitId != null &&
    fine.dutyAssignment.originalUnitId !== fine.unitId;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/b/${buildingSlug}/duty`}
            className="hover:text-ironwork underline underline-offset-4"
          >
            Duty rotation
          </Link>
        }
        title={fine.violation}
        lede={`Summons ${fine.ticketNumber} · issued ${formatDate(toPlainDate(fine.issuedOn))} · ${formatMoney(money(fine.amountCents))}`}
      />

      {fine.note ? (
        <p className="text-ironwork-soft mb-6 max-w-2xl text-sm">{fine.note}</p>
      ) : null}

      {/* ---- Whose week ---- */}
      <section>
        <h2 className="eyebrow border-limestone mb-3 border-b pb-2">
          Whose week it was
        </h2>

        {fine.dutyAssignment ? (
          <>
            <p className="text-ironwork text-lg font-medium">
              {fine.dutyAssignment.unit.label}
            </p>
            <p className="text-ironwork-soft mt-1 font-mono text-xs">
              turn ran {formatDate(toPlainDate(fine.dutyAssignment.periodStart))} to{" "}
              {formatDate(toPlainDate(fine.dutyAssignment.periodEnd))}
            </p>
            {swapped ? (
              <p className="text-ironwork-soft mt-2 max-w-2xl text-sm">
                That week was swapped, so the apartment the rotation would have picked
                is not the one that had it. The summons follows whoever actually took
                the turn.
              </p>
            ) : null}
            <p className="text-ironwork-faint mt-2 max-w-2xl text-xs leading-relaxed">
              Worked out from the date on the summons against the rota, not from
              anybody&rsquo;s memory of three weeks ago.
            </p>
          </>
        ) : (
          <p className="text-ironwork-soft max-w-2xl text-sm">
            The rota does not cover {formatDate(toPlainDate(fine.issuedOn))}, so this
            summons is not attributed to any apartment. The corporation absorbs it —
            picking somebody after the fact would be a guess with a bill attached.
          </p>
        )}
      </section>

      {/* ---- Answering it ---- */}
      <section className="mt-8">
        <h2 className="eyebrow border-limestone mb-3 border-b pb-2">
          Answering the summons
        </h2>

        {answered ? (
          <p className="text-ironwork-soft text-sm">
            {fine.contestedOn
              ? `Contested on ${formatDate(toPlainDate(fine.contestedOn))}.`
              : `Paid on ${formatDate(toPlainDate(fine.paidOn!))}.`}
            {fine.outcome ? ` ${fine.outcome}` : ""}
          </p>
        ) : (
          <>
            {fine.hearingOn ? (
              <p
                className={`mb-3 max-w-2xl border-l-2 px-3 py-2 text-sm ${
                  toPlainDate(fine.hearingOn) < now
                    ? "border-stamp bg-stamp-soft text-ironwork"
                    : "border-started-line bg-started-soft text-ironwork"
                }`}
              >
                {toPlainDate(fine.hearingOn) < now
                  ? `The answer-by date was ${formatDate(toPlainDate(fine.hearingOn))}, which has passed. A summons nobody answers is decided against the building by default.`
                  : `Answer by ${formatDate(toPlainDate(fine.hearingOn))} — ${relativeDays(now, toPlainDate(fine.hearingOn))}. Missing the window is how a contestable fine becomes an unarguable one.`}
              </p>
            ) : (
              <p className="text-ironwork-soft mb-3 max-w-2xl text-sm">
                No answer-by date was recorded. It is printed on the summons, and it is
                worth finding — the window to contest closes whether or not anyone
                noticed.
              </p>
            )}

            {mayManage ? (
              <AnswerFine
                buildingSlug={buildingSlug}
                fineId={fine.id}
                defaultDate={now}
              />
            ) : null}
          </>
        )}
      </section>

      {/* ---- Who pays ---- */}
      <section className="border-limestone mt-8 border-t pt-6">
        <h2 className="eyebrow mb-3">Who pays</h2>

        {charges.length > 0 ? (
          <>
            <ul className="space-y-1.5">
              {charges.map((charge) => (
                <li key={charge.id} className="text-ironwork text-sm">
                  <span className="font-mono">
                    {formatAmount(money(charge.amountCents))}
                  </span>{" "}
                  on {charge.unit.label}&rsquo;s ledger, due{" "}
                  {formatDate(toPlainDate(charge.dueOn))}
                </li>
              ))}
            </ul>
            <p className="text-ironwork-faint mt-2 max-w-2xl text-xs leading-relaxed">
              Correcting this means a reversing entry on{" "}
              <Link
                href={`/b/${buildingSlug}/arrears/${fine.unitId}`}
                className="text-verdigris underline underline-offset-4"
              >
                the apartment&rsquo;s ledger
              </Link>
              , not an edit.
            </p>
          </>
        ) : !fine.unitId ? (
          <p className="text-ironwork-faint max-w-2xl text-xs leading-relaxed">
            Nothing to recharge — the rota did not cover the day this was issued, so
            there is nobody the bill honestly belongs to.
          </p>
        ) : mayBill ? (
          <>
            <p className="text-ironwork-soft mb-4 max-w-2xl text-sm">
              The rota says {fine.unit?.label} had that week. Many boards absorb a first
              summons and recharge a repeat; either way it is a decision, not an
              automatic consequence.
            </p>
            <ChargeFine
              buildingSlug={buildingSlug}
              fineId={fine.id}
              unitLabel={fine.unit?.label ?? "the apartment"}
              defaultAmount={(fine.amountCents / 100).toFixed(2)}
              defaultDueOn={`${addMonths(now, 1).slice(0, 7)}-01`}
            />
          </>
        ) : (
          <p className="text-ironwork-faint max-w-2xl text-xs leading-relaxed">
            The rota says {fine.unit?.label} had that week. Only the treasurer can put
            it on a ledger.
          </p>
        )}
      </section>

      <p className="text-ironwork-faint mt-8 font-mono text-[0.6875rem]">
        logged by{" "}
        {fine.recordedBy?.user.name ?? fine.recordedBy?.user.email ?? "the board"} ·{" "}
        {formatDate(toPlainDate(fine.createdAt))}
      </p>
    </>
  );
}
