import Link from "next/link";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { dayCalendar, listBookings, listResources } from "~/lib/db/scoped/bookings";
import { listUnits } from "~/lib/db/scoped/units";
import { formatAmount, money } from "~/lib/money";
import { describeSlot } from "~/lib/primitives/bookings";
import {
  addDays,
  formatDate,
  formatInstant,
  isPlainDate,
  plainDate,
  relativeDays,
  today,
  toPlainDate,
  type PlainDate,
} from "~/lib/time";
import { AddResource, RequestBooking, RetireResource } from "./BookingForms";

/**
 * What can be booked, and who has it.
 *
 * The calendar is the page, and it is deliberately public: a neighbour
 * planning their own move has to be able to see that Saturday morning is gone,
 * and they would see the truck anyway. What each booking is *for*, and whether
 * its conditions are met, lives one click in and only for the apartment
 * involved and the board.
 */
export default async function BookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ buildingSlug: string }>;
  searchParams: Promise<{ resource?: string; date?: string }>;
}) {
  const { buildingSlug } = await params;
  const query = await searchParams;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const [resources, bookings, units] = await Promise.all([
    listResources(ctx),
    listBookings(ctx),
    listUnits(ctx),
  ]);

  const mayManage = can(ctx, "booking.manage");
  const selected =
    resources.find((resource) => resource.id === query.resource) ?? resources[0];

  // Tomorrow rather than today, because the slot you can actually still take is
  // never the one that started this morning.
  const date: PlainDate =
    query.date && isPlainDate(query.date) ? plainDate(query.date) : addDays(now, 1);

  const calendar = selected ? await dayCalendar(ctx, selected.id, date) : null;

  const upcoming = bookings
    .filter(
      (booking) =>
        booking.endsAt >= new Date() &&
        (booking.status === "HELD" || booking.status === "CONFIRMED"),
    )
    .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const past = bookings.filter((booking) => !upcoming.includes(booking));

  const held = upcoming.filter((booking) => booking.status === "HELD").length;

  return (
    <>
      <PageHeader
        eyebrow="Bookings"
        title={
          held === 0
            ? "Nothing waiting to be confirmed"
            : `${held} ${held === 1 ? "booking is" : "bookings are"} holding a slot unconfirmed`
        }
        lede="A slot is held the moment somebody asks for it, and confirms only once the building's conditions are met — the deposit recorded, the mover's certificate current on the day of the move."
        actions={mayManage ? <AddResource buildingSlug={buildingSlug} /> : null}
      />

      {resources.length === 0 ? (
        <EmptyState title="Nothing bookable yet">
          {mayManage
            ? "The freight elevator, the roof deck, the common room — anything the building schedules. Each one carries its own hours and its own conditions."
            : "Once the board lists what the building schedules, it will appear here."}
        </EmptyState>
      ) : (
        <>
          {/* --- Which thing, which day ------------------------------------ */}
          <div className="border-limestone mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-b pb-3">
            <nav className="flex flex-wrap gap-2" aria-label="What can be booked">
              {resources.map((resource) => (
                <Link
                  key={resource.id}
                  href={`/b/${buildingSlug}/bookings?resource=${resource.id}&date=${date}`}
                  className={
                    resource.id === selected?.id
                      ? "rounded-sheet border-verdigris bg-verdigris border px-2.5 py-1 text-xs font-medium text-white"
                      : "rounded-sheet border-limestone-deep text-ironwork-soft hover:text-ironwork border px-2.5 py-1 text-xs"
                  }
                >
                  {resource.name}
                </Link>
              ))}
            </nav>

            <div className="ml-auto flex items-center gap-2">
              <Link
                href={`/b/${buildingSlug}/bookings?resource=${selected?.id}&date=${addDays(date, -1)}`}
                className="text-ironwork-soft hover:text-ironwork font-mono text-xs"
              >
                ← previous
              </Link>
              <span className="text-ironwork font-mono text-xs">
                {formatDate(date)}
              </span>
              <Link
                href={`/b/${buildingSlug}/bookings?resource=${selected?.id}&date=${addDays(date, 1)}`}
                className="text-ironwork-soft hover:text-ironwork font-mono text-xs"
              >
                next →
              </Link>
            </div>
          </div>

          {/* --- The day --------------------------------------------------- */}
          {selected && calendar ? (
            <section className="mb-10">
              <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4">
                <h2 className="text-ironwork text-lg font-semibold tracking-tight">
                  {selected.name} on {formatDate(date)}
                </h2>
                <span className="text-ironwork-faint font-mono text-[0.6875rem]">
                  {relativeDays(now, date)}
                </span>
              </div>

              {calendar.slots.length === 0 ? (
                <p className="text-ironwork-soft text-sm">
                  {selected.name} has no slots — its hours are shorter than one booking.
                </p>
              ) : (
                <ul className="divide-limestone border-limestone divide-y border-y">
                  {calendar.slots.map((slot) => (
                    <li
                      key={slot.index}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 py-2.5"
                    >
                      <span
                        className={
                          slot.gone
                            ? "text-ironwork-faint font-mono text-sm"
                            : "text-ironwork font-mono text-sm"
                        }
                      >
                        {describeSlot(selected, slot.index)}
                      </span>

                      {slot.takenBy ? (
                        <Link
                          href={`/b/${buildingSlug}/bookings/${slot.takenBy.id}`}
                          className="hover:text-verdigris text-ironwork-soft text-sm"
                        >
                          {slot.takenBy.unitLabel}
                          <span className="text-ironwork-faint ml-2 font-mono text-[0.6875rem]">
                            {slot.takenBy.status === "CONFIRMED" ? "confirmed" : "held"}
                          </span>
                        </Link>
                      ) : (
                        <span className="text-ironwork-faint font-mono text-xs">
                          {slot.gone ? "gone" : "free"}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {/* Conditions, from the data rather than typed out. */}
              {selected.prerequisites.length > 0 ? (
                <>
                  <p className="eyebrow mt-4 mb-1.5">Before it confirms</p>
                  <ul className="space-y-1">
                    {selected.prerequisites.map((prerequisite) => (
                      <li
                        key={prerequisite.id}
                        className="text-ironwork-soft font-mono text-[0.6875rem]"
                      >
                        — {describePrerequisite(prerequisite.type, prerequisite.config)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-ironwork-soft mt-3 text-sm">
                  No conditions — hold a slot and it&rsquo;s yours.
                </p>
              )}

              <RequestBooking
                buildingSlug={buildingSlug}
                resourceId={selected.id}
                resourceName={selected.name}
                date={date}
                slots={calendar.slots.map((slot) => ({
                  index: slot.index,
                  label: describeSlot(selected, slot.index),
                  takenBy: slot.takenBy?.unitLabel ?? null,
                  gone: slot.gone,
                }))}
                units={
                  mayManage
                    ? units.map((unit) => ({ id: unit.id, label: unit.label }))
                    : units
                        .filter((unit) => ctx.unitIds.includes(unit.id))
                        .map((unit) => ({ id: unit.id, label: unit.label }))
                }
                defaultUnitId={ctx.unitIds[0] ?? null}
              />

              {mayManage ? (
                <div className="mt-4">
                  <RetireResource
                    buildingSlug={buildingSlug}
                    resourceId={selected.id}
                    name={selected.name}
                  />
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}

      {/* --- What is booked --------------------------------------------- */}
      <section className="mb-10">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Coming up</h2>
        {upcoming.length === 0 ? (
          <p className="text-ironwork-soft text-sm">Nothing booked.</p>
        ) : (
          <ul className="divide-limestone border-limestone divide-y border-t">
            {upcoming.map((booking) => (
              <li key={booking.id} className="py-3">
                <Link
                  href={`/b/${buildingSlug}/bookings/${booking.id}`}
                  className="hover:text-verdigris flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
                >
                  <span className="text-ironwork text-sm">
                    {booking.resource.name} — {booking.unit.label}
                  </span>
                  <span className="text-ironwork-soft font-mono text-xs">
                    {formatInstant(booking.startsAt, ctx.building.timezone)}
                    <span className="text-ironwork-faint ml-2">
                      {booking.status === "CONFIRMED" ? "confirmed" : "held"}
                    </span>
                  </span>
                </Link>
                {booking.note ? (
                  <p className="text-ironwork-soft mt-0.5 text-xs">{booking.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {past.length > 0 ? (
        <section>
          <h2 className="mb-3 text-lg font-semibold tracking-tight">Been and gone</h2>
          <ul className="divide-limestone border-limestone divide-y border-t">
            {past.slice(0, 20).map((booking) => (
              <li key={booking.id}>
                <Link
                  href={`/b/${buildingSlug}/bookings/${booking.id}`}
                  className="hover:text-verdigris flex flex-wrap items-baseline justify-between gap-x-4 py-2.5"
                >
                  <span className="text-ironwork-soft text-sm">
                    {booking.resource.name} — {booking.unit.label}
                  </span>
                  <span className="text-ironwork-faint font-mono text-xs">
                    {formatDate(toPlainDate(booking.startsAt))}
                    <span className="ml-2">{statusWord(booking.status)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}

function statusWord(status: string): string {
  switch (status) {
    case "COMPLETED":
      return "done";
    case "CANCELLED":
      return "cancelled";
    case "CONFIRMED":
      return "confirmed";
    default:
      return "held";
  }
}

/** Prerequisites are data, so their descriptions are derived rather than typed. */
export function describePrerequisite(type: string, config: unknown): string {
  const settings = (config ?? {}) as {
    amountCents?: number;
    minimumCoverageCents?: number;
    requireAdditionalInsured?: boolean;
    toleranceCents?: number;
  };

  switch (type) {
    case "DEPOSIT_PAID":
      return `A deposit of ${formatAmount(money(settings.amountCents ?? 0))} recorded`;
    case "VALID_COI":
      return `Insurance of at least ${formatAmount(
        money(settings.minimumCoverageCents ?? 0),
      )}, valid on the day${
        settings.requireAdditionalInsured === false
          ? ""
          : ", naming the corporation as an additional insured"
      }`;
    case "NO_ARREARS":
      return "Maintenance up to date";
    case "APPROVED_ALTERATION":
      return "An approved alteration covering the work";
    default:
      return type;
  }
}
