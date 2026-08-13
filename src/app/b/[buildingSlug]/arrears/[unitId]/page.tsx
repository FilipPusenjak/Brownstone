import Link from "next/link";
import { notFound } from "next/navigation";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { unitLedger } from "~/lib/db/scoped/ledger";
import { describeKind } from "~/lib/db/scoped/ledger-writes";
import { getUnit } from "~/lib/db/scoped/units";
import { canSeeUnit } from "~/lib/db/visibility";
import { formatAmount, formatMoney, money } from "~/lib/money";
import { agingFor } from "~/lib/primitives/ledger";
import { formatDate, today, toPlainDate, type PlainDate } from "~/lib/time";
import { ChargeForm, PaymentForm, ReverseButton } from "../LedgerForms";

/**
 * One apartment's ledger.
 *
 * Charges and payments interleaved by date, oldest last, with the reversed
 * pairs struck through rather than hidden. Hiding them would make the ledger
 * easier to read and much less useful: "there was a charge here once and it was
 * taken off" is exactly the thing a shareholder disputes and a future board has
 * to reconstruct.
 */
export default async function UnitLedgerPage({
  params,
}: {
  params: Promise<{ buildingSlug: string; unitId: string }>;
}) {
  const { buildingSlug, unitId } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  // A 404 rather than a 403: telling someone this apartment exists but is not
  // theirs to look at is itself a disclosure.
  if (!canSeeUnit(ctx, "arrears", unitId)) notFound();

  const unit = await getUnit(ctx, unitId);
  if (!unit) notFound();

  const { charges, payments } = await unitLedger(ctx, unitId);
  const mayPost = can(ctx, "arrears.postCharge");
  const mayRecord = can(ctx, "arrears.recordPayment");

  const aging = agingFor(
    charges.map((c) => ({
      id: c.id,
      unitId: c.unitId,
      amountCents: c.amountCents,
      dueOn: toPlainDate(c.dueOn),
      reversesChargeId: c.reversesChargeId,
    })),
    payments.map((p) => ({
      id: p.id,
      unitId: p.unitId,
      amountCents: p.amountCents,
      receivedOn: toPlainDate(p.receivedOn),
      reversesPaymentId: p.reversesPaymentId,
    })),
    now,
  );

  const reversedCharges = new Set(
    charges.map((c) => c.reversesChargeId).filter((id): id is string => Boolean(id)),
  );
  const reversedPayments = new Set(
    payments.map((p) => p.reversesPaymentId).filter((id): id is string => Boolean(id)),
  );

  type Entry = {
    id: string;
    kind: "charge" | "payment";
    on: PlainDate;
    label: string;
    detail: string | null;
    amountCents: number;
    isReversal: boolean;
    isReversed: boolean;
  };

  const entries: Entry[] = [
    ...charges.map((c) => ({
      id: c.id,
      kind: "charge" as const,
      on: toPlainDate(c.dueOn),
      label: describeKind(c.kind),
      detail: c.memo,
      amountCents: c.amountCents,
      isReversal: Boolean(c.reversesChargeId),
      isReversed: reversedCharges.has(c.id),
    })),
    ...payments.map((p) => ({
      id: p.id,
      kind: "payment" as const,
      on: toPlainDate(p.receivedOn),
      label: "Payment",
      detail: p.reference ? `ref ${p.reference}` : p.memo,
      amountCents: -p.amountCents,
      isReversal: Boolean(p.reversesPaymentId),
      isReversed: reversedPayments.has(p.id),
    })),
  ].sort((a, b) => b.on.localeCompare(a.on) || a.label.localeCompare(b.label));

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/b/${buildingSlug}/arrears`}
            className="hover:text-ironwork underline underline-offset-4"
          >
            Arrears
          </Link>
        }
        title={unit.label}
        lede={
          aging.total > 0
            ? `${formatMoney(money(aging.total))} outstanding.`
            : "Nothing outstanding."
        }
      />

      <dl className="border-limestone-deep mb-8 grid grid-cols-2 gap-x-4 gap-y-3 border-y py-4 sm:grid-cols-5">
        <Bucket label="Current" cents={aging.current} />
        <Bucket label="1–30" cents={aging.days30} />
        <Bucket label="31–60" cents={aging.days60} />
        <Bucket label="61–90" cents={aging.days90} />
        <Bucket label="90+" cents={aging.over90} overdue />
      </dl>

      {mayPost || mayRecord ? (
        <div className="mb-8 flex flex-wrap gap-2">
          {mayRecord ? (
            <PaymentForm
              buildingSlug={buildingSlug}
              unitId={unit.id}
              unitLabel={unit.label}
              today={now}
            />
          ) : null}
          {mayPost ? (
            <ChargeForm
              buildingSlug={buildingSlug}
              unitId={unit.id}
              unitLabel={unit.label}
              today={now}
            />
          ) : null}
        </div>
      ) : null}

      {entries.length === 0 ? (
        <EmptyState title="Nothing on this ledger yet">
          Charges posted to this apartment and the payments against them will appear
          here.
        </EmptyState>
      ) : (
        <ul className="divide-limestone divide-y">
          {entries.map((entry) => (
            <li key={`${entry.kind}-${entry.id}`} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <div className="min-w-0">
                  <span
                    className={`text-sm ${
                      entry.isReversed || entry.isReversal
                        ? "text-ironwork-faint line-through"
                        : "text-ironwork"
                    }`}
                  >
                    {entry.isReversal ? `${entry.label} reversed` : entry.label}
                  </span>
                  <span className="text-ironwork-faint mt-0.5 flex flex-wrap gap-x-2 font-mono text-[0.6875rem]">
                    <span>{formatDate(entry.on)}</span>
                    {entry.detail ? <span>{entry.detail}</span> : null}
                    {entry.isReversed ? (
                      <span className="text-stamp">reversed</span>
                    ) : null}
                  </span>
                </div>

                <div className="flex items-baseline gap-3">
                  <span
                    className={`font-mono text-xs whitespace-nowrap ${
                      entry.isReversed || entry.isReversal
                        ? "text-ironwork-faint line-through"
                        : entry.amountCents < 0
                          ? "text-complete"
                          : "text-ironwork"
                    }`}
                  >
                    {entry.amountCents < 0 ? "−" : ""}
                    {formatAmount(money(Math.abs(entry.amountCents)))}
                  </span>

                  {!entry.isReversal &&
                  !entry.isReversed &&
                  (entry.kind === "charge" ? mayPost : mayRecord) ? (
                    <ReverseButton
                      buildingSlug={buildingSlug}
                      entryId={entry.id}
                      kind={entry.kind}
                    />
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Bucket({
  label,
  cents,
  overdue,
}: {
  label: string;
  cents: number;
  overdue?: boolean;
}) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={`mt-1 font-mono text-sm ${
          cents === 0 ? "text-ironwork-faint" : overdue ? "text-stamp" : "text-ironwork"
        }`}
      >
        {cents === 0 ? "—" : formatAmount(money(cents))}
      </dd>
    </div>
  );
}
