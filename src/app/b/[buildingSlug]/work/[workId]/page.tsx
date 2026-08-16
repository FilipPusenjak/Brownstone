import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "~/components/patterns/PageHeader";
import { ShareSplit } from "~/components/patterns/ShareSplit";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { listUnitsWithShares } from "~/lib/db/scoped/units";
import { assessmentCharges, getWork } from "~/lib/db/scoped/work";
import { formatAmount, formatMoney, money } from "~/lib/money";
import { addMonths, formatDate, today, toPlainDate } from "~/lib/time";
import { RaiseAssessment, WorkControls } from "../WorkForms";

/**
 * One piece of building work, and what it costs each apartment.
 *
 * Two states, and the difference matters. Before an assessment is raised the
 * split is a projection — what this *would* cost each apartment if the board
 * went ahead, recomputed live from the current share register. After it is
 * raised the split is history: the charges that actually landed, read back from
 * the ledger rather than recalculated, because shares may have moved since and
 * the bill somebody received does not change when their neighbour sells.
 */
export default async function WorkDetailPage({
  params,
}: {
  params: Promise<{ buildingSlug: string; workId: string }>;
}) {
  const { buildingSlug, workId } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const work = await getWork(ctx, workId);
  if (!work) notFound();

  const mayManage = can(ctx, "work.manage");
  const mayRaise = can(ctx, "arrears.postCharge");
  const raised = Boolean(work.assessmentRaisedAt);

  // Shares as of the assessment's due date once raised, so the projection and
  // the record are read on the same basis they were written on.
  const asOf = work.assessmentDueOn ? toPlainDate(work.assessmentDueOn) : now;
  const units = await listUnitsWithShares(ctx, asOf);
  const charges = raised ? await assessmentCharges(ctx, workId) : [];

  const estimate = work.assessmentTotalCents ?? work.estimateCents ?? 0;

  // A live charge is one with no reversal against it.
  const reversed = new Set(
    charges.map((c) => c.reversesChargeId).filter((id): id is string => Boolean(id)),
  );
  const liveCharges = charges.filter(
    (charge) => !charge.reversesChargeId && !reversed.has(charge.id),
  );
  const raisedTotal = liveCharges.reduce((sum, charge) => sum + charge.amountCents, 0);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/b/${buildingSlug}/work`}
            className="hover:text-ironwork underline underline-offset-4"
          >
            Building work
          </Link>
        }
        title={work.title}
        lede={
          raised
            ? `${formatMoney(money(raisedTotal))} assessed across ${liveCharges.length} apartments, due ${work.assessmentDueOn ? formatDate(toPlainDate(work.assessmentDueOn)) : "—"}.`
            : estimate > 0
              ? `Estimated at ${formatMoney(money(estimate))}. Nothing has been charged to anyone yet.`
              : "No estimate recorded yet."
        }
      />

      {work.detail ? (
        <p className="text-ironwork-soft mb-6 max-w-2xl text-sm">{work.detail}</p>
      ) : null}

      {work.obligation ? (
        <p className="text-ironwork-faint mb-6 text-xs">
          Comes from{" "}
          <Link
            href={`/b/${buildingSlug}/compliance/${work.obligation.id}`}
            className="text-verdigris underline underline-offset-4"
          >
            {work.obligation.title}
          </Link>{" "}
          on the compliance calendar.
        </p>
      ) : null}

      {mayManage ? (
        <div className="border-limestone mb-8 border-y py-4">
          <WorkControls
            buildingSlug={buildingSlug}
            workId={work.id}
            status={work.status}
            estimateLocked={raised}
          />
        </div>
      ) : null}

      <section className="mt-8">
        <h2 className="eyebrow border-limestone mb-3 border-b pb-2">
          {raised ? "What each apartment was charged" : "What each apartment would pay"}
        </h2>

        {raised ? (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <caption className="sr-only">Assessment charges by apartment</caption>
              <thead>
                <tr className="border-limestone-deep border-b">
                  <th scope="col" className="eyebrow pr-4 pb-2 font-normal">
                    Apartment
                  </th>
                  <th scope="col" className="eyebrow pr-4 pb-2 text-right font-normal">
                    Share
                  </th>
                  <th scope="col" className="eyebrow pb-2 text-right font-normal">
                    Charged
                  </th>
                </tr>
              </thead>
              <tbody>
                {liveCharges.map((charge) => (
                  <tr key={charge.id} className="ledger-row align-baseline">
                    <td className="text-ironwork py-3 pr-4 font-mono text-xs">
                      {charge.unit.label}
                    </td>
                    <td className="text-ironwork-soft py-3 pr-4 text-right font-mono text-xs">
                      {raisedTotal > 0
                        ? `${((charge.amountCents / raisedTotal) * 100).toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="text-ironwork py-3 text-right font-mono text-xs font-medium">
                      {formatAmount(money(charge.amountCents))}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-limestone-deep border-t-2">
                  <td className="eyebrow py-3 pr-4">Total</td>
                  <td className="text-ironwork-soft py-3 pr-4 text-right font-mono text-xs">
                    100%
                  </td>
                  <td className="text-ironwork py-3 text-right font-mono text-xs font-medium">
                    {formatMoney(money(raisedTotal))}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : estimate > 0 ? (
          <ShareSplit
            holdings={units.map((unit) => ({
              unitId: unit.id,
              label: unit.label,
              holderName: unit.holderName,
              shares: unit.shares,
            }))}
            totalCents={estimate}
            caption={`Cost of ${work.title} split by shares`}
          />
        ) : (
          <p className="text-ironwork-soft text-sm">
            {mayManage
              ? "Record an estimate above and the split across the apartments will appear here."
              : "Once the board records an estimate, each apartment's share of it will appear here."}
          </p>
        )}
      </section>

      {raised ? (
        <p className="text-ironwork-faint mt-6 max-w-2xl text-xs leading-relaxed">
          These charges are on each apartment&rsquo;s ledger and were raised by{" "}
          {work.assessmentRaisedBy?.user.name ??
            work.assessmentRaisedBy?.user.email ??
            "the treasurer"}
          . Correcting one means a reversing entry against it, not an edit.
        </p>
      ) : mayRaise && estimate > 0 ? (
        <section className="border-limestone mt-8 border-t pt-6">
          <h2 className="eyebrow mb-3">Raise the assessment</h2>
          <p className="text-ironwork-soft mb-4 max-w-2xl text-sm">
            This is the step that turns the estimate above into money owed. It posts one
            charge to every apartment, share-weighted, and can only be done once.
          </p>
          <RaiseAssessment
            buildingSlug={buildingSlug}
            workId={work.id}
            defaultDueOn={`${addMonths(now, 1).slice(0, 7)}-01`}
            defaultTotal={(estimate / 100).toFixed(2)}
            apartments={units.filter((unit) => unit.shares > 0).length}
          />
        </section>
      ) : !mayRaise && estimate > 0 ? (
        <p className="text-ironwork-faint mt-8 max-w-2xl text-xs leading-relaxed">
          Nothing here has been charged to anyone. Only the treasurer can raise an
          assessment.
        </p>
      ) : null}
    </>
  );
}
