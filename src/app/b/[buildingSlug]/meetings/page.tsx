import Link from "next/link";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { listMeetings, quorumThreshold } from "~/lib/db/scoped/meetings";
import { listUnitsWithShares } from "~/lib/db/scoped/units";
import { sharesNeeded, totalShares } from "~/lib/primitives/shares";
import { addMonths, formatInstant, today } from "~/lib/time";
import { ScheduleMeeting } from "./MeetingForms";

/**
 * Meetings and proxies.
 *
 * Quorum in a co-op is share-weighted, never counted by apartment, and the
 * threshold each meeting was called under is stored as an exact fraction rather
 * than a percentage. Two-thirds of 1,200 shares is exactly 800; 66.67% of them
 * is 801, and the meeting with precisely two-thirds present would be recorded
 * as inquorate over a rounding artefact. So every number on this page is read
 * off the stored fraction, and nothing is divided on the way.
 */
export default async function MeetingsPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const [meetings, units] = await Promise.all([
    listMeetings(ctx),
    listUnitsWithShares(ctx),
  ]);

  const total = totalShares(units.map((u) => ({ unitId: u.id, shares: u.shares })));
  const mayManage = can(ctx, "meeting.manage");

  return (
    <>
      <PageHeader
        eyebrow="Meetings & proxies"
        title="Meetings"
        lede={`Quorum in this building is share-weighted against ${total.toLocaleString("en-US")} shares, not counted by apartment.`}
        actions={
          mayManage ? (
            <ScheduleMeeting
              buildingSlug={buildingSlug}
              defaultDate={addMonths(today(ctx.building.timezone), 1)}
            />
          ) : null
        }
      />

      {meetings.length === 0 ? (
        <EmptyState title="No meetings recorded">
          {mayManage
            ? "Call the annual meeting and the roster, the proxies and the resolutions will hang off it."
            : "Annual meetings, special meetings and board meetings will appear here once the board calls one."}
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Meetings</caption>
            <thead>
              <tr className="border-limestone-deep border-b">
                <th scope="col" className="eyebrow pr-4 pb-2 font-normal">
                  Meeting
                </th>
                <th
                  scope="col"
                  className="eyebrow hidden pr-4 pb-2 font-normal sm:table-cell"
                >
                  When
                </th>
                <th scope="col" className="eyebrow pr-4 pb-2 text-right font-normal">
                  Quorum needs
                </th>
                <th scope="col" className="eyebrow pb-2 text-right font-normal">
                  Record
                </th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((meeting) => {
                const threshold = quorumThreshold(meeting);
                const needed = sharesNeeded(total, threshold);

                return (
                  <tr key={meeting.id} className="ledger-row align-baseline">
                    <td className="py-3 pr-4">
                      <Link
                        href={`/b/${buildingSlug}/meetings/${meeting.id}`}
                        className="text-ironwork hover:text-verdigris block text-sm font-medium underline-offset-4 hover:underline"
                      >
                        {meeting.title}
                      </Link>
                      <span className="text-ironwork-faint font-mono text-[0.6875rem]">
                        {meeting.type.toLowerCase()}
                        {meeting.location ? ` · ${meeting.location}` : ""}
                      </span>
                    </td>
                    <td className="text-ironwork-soft hidden py-3 pr-4 font-mono text-xs whitespace-nowrap sm:table-cell">
                      {formatInstant(meeting.scheduledFor, ctx.building.timezone)}
                    </td>
                    <td className="text-ironwork py-3 pr-4 text-right font-mono text-xs whitespace-nowrap">
                      {needed.toLocaleString("en-US")} sh
                      <span className="text-ironwork-faint block">
                        {threshold.label}
                      </span>
                    </td>
                    <td className="text-ironwork-soft py-3 text-right font-mono text-xs">
                      {meeting.minutesAdoptedAt ? (
                        <span className="text-complete">minutes adopted</span>
                      ) : meeting._count.resolutions > 0 ? (
                        `${meeting._count.resolutions} resolution${meeting._count.resolutions === 1 ? "" : "s"}`
                      ) : meeting._count.attendance > 0 ? (
                        `${meeting._count.attendance} present`
                      ) : (
                        "—"
                      )}
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
