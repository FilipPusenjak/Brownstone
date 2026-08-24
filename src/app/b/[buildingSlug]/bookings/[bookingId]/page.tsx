import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { evaluateBooking, getBooking } from "~/lib/db/scoped/bookings";
import { formatAmount, formatMoney, money } from "~/lib/money";
import { formatDate, formatInstant, today, toPlainDate } from "~/lib/time";
import {
  CancelBooking,
  ConfirmBooking,
  RecordDeposit,
  ReturnDeposit,
} from "../BookingForms";
import { describePrerequisite } from "../page";

/**
 * One booking.
 *
 * The page is arranged around the question somebody actually arrives with:
 * *can this go ahead?* So the conditions come first, evaluated live against the
 * day of the move rather than read back from whenever somebody last pressed a
 * button — and next to them, what was recorded when the board did press it.
 * When the two disagree, that is worth seeing: a certificate that expired after
 * confirmation is exactly the thing nobody notices until the movers arrive.
 */
export default async function BookingPage({
  params,
}: {
  params: Promise<{ buildingSlug: string; bookingId: string }>;
}) {
  const { buildingSlug, bookingId } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const booking = await getBooking(ctx, bookingId);
  if (!booking) notFound();

  const now = today(ctx.building.timezone);
  const mayManage = can(ctx, "booking.manage");
  const own = ctx.unitIds.includes(booking.unitId);
  const live = booking.detailed ? await evaluateBooking(ctx, bookingId) : null;

  const held = booking.status === "HELD" || booking.status === "CONFIRMED";
  const depositRequired = booking.resource.prerequisites.find(
    (prerequisite) => prerequisite.type === "DEPOSIT_PAID",
  );

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/b/${buildingSlug}/bookings`} className="hover:text-verdigris">
            Bookings
          </Link>
        }
        title={`${booking.resource.name} — ${booking.unit.label}`}
        lede={`${formatInstant(booking.startsAt, ctx.building.timezone)} to ${formatInstant(
          booking.endsAt,
          ctx.building.timezone,
        )}`}
      />

      <p className="text-ironwork-soft mb-6 text-sm">
        {booking.status === "CONFIRMED"
          ? `Confirmed${booking.confirmedBy ? ` by ${nameOf(booking.confirmedBy)}` : ""}. The slot is theirs.`
          : booking.status === "HELD"
            ? "Holding the slot. Nobody else can take it, and it is not confirmed until the conditions below are met."
            : booking.status === "CANCELLED"
              ? `Cancelled${booking.cancelledReason ? ` — ${booking.cancelledReason}` : ""}. The slot went back on the calendar.`
              : "Been and gone."}
      </p>

      {!booking.detailed ? (
        <p className="text-ironwork-soft text-sm">
          The slot is on the calendar for everyone to see. What it is for, and whether
          it is clear to go ahead, is between {booking.unit.label} and the board.
        </p>
      ) : (
        <>
          {booking.note ? (
            <section className="mb-8">
              <p className="eyebrow mb-1.5">What for</p>
              <p className="text-ironwork text-sm">{booking.note}</p>
            </section>
          ) : null}

          {/* --- The conditions ------------------------------------------- */}
          <section className="mb-8">
            <h2 className="border-limestone mb-3 border-b pb-2 text-lg font-semibold tracking-tight">
              Whether it can go ahead
            </h2>

            {booking.resource.prerequisites.length === 0 ? (
              <p className="text-ironwork-soft text-sm">
                {booking.resource.name} has no conditions. Holding the slot is all there
                is to it.
              </p>
            ) : (
              <>
                <p className="text-ironwork-soft mb-3 text-sm">
                  Checked against {formatDate(toPlainDate(booking.startsAt))}, the day
                  of the booking — not against today. A certificate that lapses in
                  between is the failure this exists to catch.
                </p>

                <ul className="divide-limestone border-limestone divide-y border-y">
                  {booking.resource.prerequisites.map((prerequisite) => {
                    const outcome = live?.outcomes.find(
                      (row) => row.prerequisiteId === prerequisite.id,
                    );
                    const recorded = booking.checks.find(
                      (check) => check.prerequisiteId === prerequisite.id,
                    );

                    return (
                      <li key={prerequisite.id} className="py-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                          <span className="text-ironwork text-sm">
                            {describePrerequisite(
                              prerequisite.type,
                              prerequisite.config,
                            )}
                          </span>
                          <span
                            className={
                              outcome?.satisfied
                                ? "text-complete font-mono text-[0.6875rem]"
                                : "text-stamp font-mono text-[0.6875rem]"
                            }
                          >
                            {outcome?.satisfied ? "met" : "not met"}
                          </span>
                        </div>

                        {outcome ? (
                          <p className="text-ironwork-soft mt-1 text-xs">
                            {outcome.message}
                          </p>
                        ) : null}

                        {recorded && recorded.satisfied !== outcome?.satisfied ? (
                          <p className="text-stamp mt-1 text-xs">
                            This was recorded as{" "}
                            {recorded.satisfied ? "met" : "not met"} on{" "}
                            {formatDate(toPlainDate(recorded.checkedAt))} and no longer
                            reads the same. Somebody should look before the day.
                          </p>
                        ) : recorded ? (
                          <p className="text-ironwork-faint mt-1 font-mono text-[0.6875rem]">
                            checked {formatDate(toPlainDate(recorded.checkedAt))}
                          </p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {mayManage &&
            held &&
            booking.status !== "CONFIRMED" &&
            !booking.hasHappened ? (
              <div className="mt-4">
                <ConfirmBooking buildingSlug={buildingSlug} bookingId={booking.id} />
              </div>
            ) : null}
          </section>

          {/* --- The deposit ---------------------------------------------- */}
          {depositRequired || booking.depositReceivedOn ? (
            <section className="mb-8">
              <h2 className="border-limestone mb-3 border-b pb-2 text-lg font-semibold tracking-tight">
                The deposit
              </h2>

              {booking.depositReceivedOn ? (
                <dl className="text-sm">
                  <div className="flex justify-between py-1">
                    <dt className="text-ironwork-soft">Received</dt>
                    <dd className="text-ironwork font-mono">
                      {formatMoney(money(booking.depositCents ?? 0))} on{" "}
                      {formatDate(toPlainDate(booking.depositReceivedOn))}
                      {booking.depositReference ? ` · ${booking.depositReference}` : ""}
                    </dd>
                  </div>
                  {booking.depositReturnedOn ? (
                    <div className="flex justify-between py-1">
                      <dt className="text-ironwork-soft">Returned</dt>
                      <dd className="text-ironwork font-mono">
                        {formatMoney(
                          money(
                            (booking.depositCents ?? 0) -
                              (booking.depositWithheldCents ?? 0),
                          ),
                        )}{" "}
                        on {formatDate(toPlainDate(booking.depositReturnedOn))}
                      </dd>
                    </div>
                  ) : null}
                  {booking.depositWithheldCents ? (
                    <div className="flex justify-between py-1">
                      <dt className="text-ironwork-soft">Kept back</dt>
                      <dd className="text-stamp font-mono">
                        {formatMoney(money(booking.depositWithheldCents))}
                        {booking.depositNote ? ` — ${booking.depositNote}` : ""}
                      </dd>
                    </div>
                  ) : null}
                </dl>
              ) : (
                <p className="text-ironwork-soft text-sm">
                  {depositRequired
                    ? `${formatAmount(
                        money(
                          ((depositRequired.config ?? {}) as { amountCents?: number })
                            .amountCents ?? 0,
                        ),
                      )} due before this confirms. Nothing recorded yet.`
                    : "Nothing recorded."}
                </p>
              )}

              <p className="text-ironwork-faint mt-3 text-xs leading-relaxed">
                Recorded here and nowhere else. A deposit is money the building is
                holding, not money the apartment owes, so it stays off the maintenance
                ledger — damage costing more than the deposit is a repair the board has
                to hold somebody responsible for, and that gets billed with the
                determination attached.
              </p>

              {mayManage ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  {!booking.depositReturnedOn ? (
                    <RecordDeposit
                      buildingSlug={buildingSlug}
                      bookingId={booking.id}
                      today={now}
                      suggestedAmount={String(
                        (((depositRequired?.config ?? {}) as { amountCents?: number })
                          .amountCents ?? 0) / 100,
                      )}
                    />
                  ) : null}

                  {booking.depositReceivedOn && !booking.depositReturnedOn ? (
                    <ReturnDeposit
                      buildingSlug={buildingSlug}
                      bookingId={booking.id}
                      today={now}
                    />
                  ) : null}
                </div>
              ) : null}
            </section>
          ) : null}

          {/* --- Giving it up --------------------------------------------- */}
          {held && (own || mayManage) ? (
            <section>
              <CancelBooking
                buildingSlug={buildingSlug}
                bookingId={booking.id}
                own={own}
              />
            </section>
          ) : null}
        </>
      )}
    </>
  );
}

function nameOf(who: { user: { name: string | null; email: string } } | null): string {
  return who?.user.name ?? who?.user.email ?? "the board";
}
