import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { ScaffoldNotice } from "~/components/patterns/ScaffoldNotice";
import { getBuildingContext } from "~/lib/auth/current";
import { listBookings, listResources } from "~/lib/db/scoped/modules";
import { formatAmount, money } from "~/lib/money";
import { formatInstant } from "~/lib/time";

export const MISSING = [
  "Requesting a slot, and the calendar to pick it from",
  "Running the prerequisite checks at confirmation",
  "Cancellation, and returning the deposit",
];

export default async function BookingsPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const [resources, bookings] = await Promise.all([
    listResources(ctx),
    listBookings(ctx),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Bookings"
        title="What can be booked"
        lede="A booking confirms only when its prerequisites are satisfied — the deposit recorded, the mover's certificate current on the day of the move."
      />

      <ScaffoldNotice missing={MISSING} />

      {resources.length === 0 ? (
        <EmptyState title="Nothing bookable yet">
          The freight elevator, the roof deck, the common room — anything the
          building schedules.
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {resources.map((resource) => (
            <li key={resource.id} className="sheet px-4 py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-medium text-ironwork">
                  {resource.name}
                </span>
                <span className="font-mono text-[0.6875rem] text-ironwork-faint">
                  {resource.slotMinutes / 60}-hour slots
                </span>
              </div>

              {resource.prerequisites.length > 0 ? (
                <>
                  <p className="eyebrow mt-3 mb-1.5">Before it confirms</p>
                  <ul className="space-y-1">
                    {resource.prerequisites.map((prerequisite) => (
                      <li
                        key={prerequisite.id}
                        className="font-mono text-[0.6875rem] text-ironwork-soft"
                      >
                        — {describePrerequisite(prerequisite.type, prerequisite.config)}
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="mt-2 text-sm text-ironwork-soft">
                  No conditions — book it and it&rsquo;s yours.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}

      <section className="mt-8">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Bookings</h2>
        {bookings.length === 0 ? (
          <p className="text-sm text-ironwork-soft">Nothing booked yet.</p>
        ) : (
          <ul className="divide-y divide-limestone border-t border-limestone">
            {bookings.map((booking) => (
              <li
                key={booking.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 py-3"
              >
                <span className="text-sm text-ironwork">
                  {booking.resource.name} — {booking.unit.label}
                </span>
                <span className="font-mono text-xs text-ironwork-soft">
                  {formatInstant(booking.startsAt, ctx.building.timezone)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Prerequisites are data, so their descriptions are derived rather than typed. */
function describePrerequisite(type: string, config: unknown): string {
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
