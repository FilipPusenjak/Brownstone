import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { ScaffoldNotice } from "~/components/patterns/ScaffoldNotice";
import { getBuildingContext } from "~/lib/auth/current";
import { listMeetings } from "~/lib/db/scoped/modules";
import { listUnitsWithShares } from "~/lib/db/scoped/units";
import { formatBasisPoints, totalShares, weightOf } from "~/lib/primitives/shares";
import { formatInstant } from "~/lib/time";

export const MISSING = [
  "Digital proxy collection, and revoking one",
  "Live quorum as attendance is recorded",
  "Minutes: drafting, adoption, and the document link",
  "Resolutions and share-weighted voting",
];

/**
 * Meetings and proxies — scaffold.
 *
 * The share-weighted quorum arithmetic is already built and tested in
 * `src/lib/primitives/shares.ts`; what is missing is the workflow around it.
 * The threshold shown here is read from each meeting's stored fraction, so the
 * hard part — two-thirds being exact rather than 66.67% — is already right.
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

  return (
    <>
      <PageHeader
        eyebrow="Meetings & proxies"
        title="Meetings"
        lede={`Quorum in this building is share-weighted against ${total.toLocaleString("en-US")} shares, not counted by apartment.`}
      />

      <ScaffoldNotice missing={MISSING} />

      {meetings.length === 0 ? (
        <EmptyState title="No meetings recorded">
          Annual meetings, special meetings and board meetings will appear here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Meetings</caption>
            <thead>
              <tr className="border-b border-limestone-deep">
                <th scope="col" className="eyebrow pb-2 pr-4 font-normal">Meeting</th>
                <th scope="col" className="eyebrow hidden pb-2 pr-4 font-normal sm:table-cell">When</th>
                <th scope="col" className="eyebrow pb-2 pr-4 text-right font-normal">Quorum needs</th>
                <th scope="col" className="eyebrow pb-2 text-right font-normal">Recorded</th>
              </tr>
            </thead>
            <tbody>
              {meetings.map((meeting) => {
                const needed = Math.ceil(
                  (total * meeting.quorumNumerator) / meeting.quorumDenominator,
                );
                const present = meeting._count.attendance + meeting._count.proxies;

                return (
                  <tr key={meeting.id} className="ledger-row align-baseline">
                    <td className="py-3 pr-4">
                      <span className="block text-sm font-medium text-ironwork">
                        {meeting.title}
                      </span>
                      <span className="font-mono text-[0.6875rem] text-ironwork-faint">
                        {meeting.type.toLowerCase()}
                        {meeting.location ? ` · ${meeting.location}` : ""}
                      </span>
                    </td>
                    <td className="hidden py-3 pr-4 font-mono text-xs whitespace-nowrap text-ironwork-soft sm:table-cell">
                      {formatInstant(meeting.scheduledFor, ctx.building.timezone)}
                    </td>
                    <td className="py-3 pr-4 text-right font-mono text-xs whitespace-nowrap text-ironwork">
                      {needed.toLocaleString("en-US")} sh
                      <span className="block text-ironwork-faint">
                        {formatBasisPoints(weightOf(needed, total))}
                      </span>
                    </td>
                    <td className="py-3 text-right font-mono text-xs text-ironwork-soft">
                      {present === 0 ? "—" : `${present} units`}
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
