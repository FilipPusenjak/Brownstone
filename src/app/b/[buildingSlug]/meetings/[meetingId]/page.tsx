import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "~/components/patterns/PageHeader";
import { OutcomeChip, QuorumMeter } from "~/components/patterns/Quorum";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import {
  getMeeting,
  liveProxies,
  outcomeOf,
  quorumFor,
  quorumThreshold,
} from "~/lib/db/scoped/meetings";
import { listUnitsWithShares } from "~/lib/db/scoped/units";
import { formatMoney, money } from "~/lib/money";
import { formatBasisPoints, weightOf } from "~/lib/primitives/shares";
import { formatInstant, toPlainDate } from "~/lib/time";
import {
  AttendanceRoster,
  GrantProxy,
  MeetingHeldToggle,
  MinutesEditor,
  RecordResolution,
  RevokeProxy,
  type RosterRow,
  type VoterRow,
} from "../MeetingForms";

/**
 * One meeting: who was there, who held whose vote, what carried.
 *
 * The page is ordered the way a chair runs the room — quorum first, because
 * nothing else is valid without it, then the roster that produces it, then the
 * proxies, then the business, then the minutes. Once the minutes are adopted
 * every control disappears and the page becomes what it will be in ten years:
 * a record.
 *
 * Shares are read as of the meeting's own date. A meeting held in 2024 keeps
 * showing 2024's register after an apartment changes hands, because the quorum
 * that authorised its resolutions was the quorum that existed on the night.
 */
export default async function MeetingDetailPage({
  params,
}: {
  params: Promise<{ buildingSlug: string; meetingId: string }>;
}) {
  const { buildingSlug, meetingId } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const meeting = await getMeeting(ctx, meetingId);
  if (!meeting) notFound();

  const units = await listUnitsWithShares(ctx, toPlainDate(meeting.scheduledFor));
  const holdings = units.map((unit) => ({ unitId: unit.id, shares: unit.shares }));

  const quorum = quorumFor({
    meeting,
    attendance: meeting.attendance,
    proxies: meeting.proxies,
    holdings,
  });

  const mayManage = can(ctx, "meeting.manage");
  const adopted = Boolean(meeting.minutesAdoptedAt);
  const live = liveProxies(meeting.proxies);

  const attendanceByUnit = new Map(meeting.attendance.map((row) => [row.unitId, row]));
  const proxyByUnit = new Map(live.map((proxy) => [proxy.unitId, proxy]));

  const roster: RosterRow[] = units.map((unit) => {
    const proxy = proxyByUnit.get(unit.id);
    return {
      unitId: unit.id,
      label: unit.label,
      holderName: unit.holderName,
      shares: unit.shares,
      mode: attendanceByUnit.get(unit.id)?.mode ?? null,
      proxyHolder: proxy?.holderName ?? null,
      proxyId: proxy?.id ?? null,
    };
  });

  // Only apartments the record says were represented may be offered a vote.
  const voters: VoterRow[] = roster
    .filter((row) => row.mode !== null)
    .map((row) => ({
      unitId: row.unitId,
      label: row.label,
      shares: row.shares,
      byProxy: proxyByUnit.has(row.unitId),
    }));

  // A shareholder may give away their own apartment's vote, and no one else's.
  const ownUnits = units
    .filter((unit) => ctx.unitIds.includes(unit.id))
    .map((unit) => ({ id: unit.id, label: unit.label }));

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/b/${buildingSlug}/meetings`}
            className="hover:text-ironwork underline underline-offset-4"
          >
            Meetings
          </Link>
        }
        title={meeting.title}
        lede={`${meeting.type.toLowerCase()} meeting · ${formatInstant(meeting.scheduledFor, ctx.building.timezone)}${meeting.location ? ` · ${meeting.location}` : ""}`}
      />

      {adopted ? (
        <p className="border-complete-line bg-complete-soft text-ironwork mb-6 border-l-2 px-3 py-2 text-sm">
          The board adopted these minutes
          {meeting.minutesAdoptedAt
            ? ` on ${formatInstant(meeting.minutesAdoptedAt, ctx.building.timezone)}`
            : ""}
          {meeting.minutesAdopted?.user.name
            ? `, recorded by ${meeting.minutesAdopted.user.name}`
            : ""}
          . This meeting&rsquo;s record is closed.
        </p>
      ) : null}

      <QuorumMeter quorum={quorum} threshold={quorumThreshold(meeting)} />

      {meeting.agenda ? (
        <section className="mt-8">
          <h2 className="eyebrow border-limestone mb-3 border-b pb-2">Agenda</h2>
          <p className="text-ironwork-soft max-w-2xl text-sm whitespace-pre-line">
            {meeting.agenda}
          </p>
        </section>
      ) : null}

      {mayManage && !adopted ? (
        <div className="border-limestone mt-6 border-y py-4">
          <MeetingHeldToggle
            buildingSlug={buildingSlug}
            meetingId={meeting.id}
            held={Boolean(meeting.heldAt)}
          />
        </div>
      ) : null}

      <section className="mt-8">
        <h2 className="eyebrow border-limestone mb-3 border-b pb-2">Who is here</h2>
        <AttendanceRoster
          buildingSlug={buildingSlug}
          meetingId={meeting.id}
          rows={roster}
          locked={adopted || !mayManage}
        />
      </section>

      <section className="mt-8">
        <h2 className="eyebrow border-limestone mb-3 border-b pb-2">Proxies</h2>

        {meeting.proxies.length === 0 ? (
          <p className="text-ironwork-soft mb-4 max-w-2xl text-sm">
            Nobody has given their apartment&rsquo;s vote to anyone else for this
            meeting.
          </p>
        ) : (
          <ul className="mb-4 space-y-2">
            {meeting.proxies.map((proxy) => {
              const revoked = Boolean(proxy.revokedAt);
              const superseded =
                revoked && live.some((current) => current.unitId === proxy.unitId);

              return (
                <li
                  key={proxy.id}
                  className="border-limestone flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b pb-2 last:border-0"
                >
                  <span className="text-sm">
                    <span className="text-ironwork font-mono text-xs">
                      {proxy.unit.label}
                    </span>{" "}
                    <span className={revoked ? "text-ironwork-faint" : "text-ironwork"}>
                      {revoked ? "gave" : "gives"} its vote to {proxy.holderName}
                    </span>
                    {proxy.evidence ? (
                      <span className="text-ironwork-faint"> · {proxy.evidence}</span>
                    ) : null}
                  </span>

                  <span className="text-ironwork-faint font-mono text-[0.6875rem]">
                    {revoked
                      ? superseded
                        ? "superseded"
                        : "revoked"
                      : `${units.find((u) => u.id === proxy.unitId)?.shares.toLocaleString("en-US") ?? "—"} sh`}
                    {!revoked && !adopted ? (
                      <>
                        {" · "}
                        <RevokeProxy buildingSlug={buildingSlug} proxyId={proxy.id} />
                      </>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {adopted ? null : (
          <div className="flex flex-wrap gap-3">
            {ownUnits.length > 0 ? (
              <GrantProxy
                buildingSlug={buildingSlug}
                meetingId={meeting.id}
                units={ownUnits}
                label={
                  ownUnits.length === 1
                    ? `Give ${ownUnits[0]!.label}'s vote to someone`
                    : "Give your apartment's vote to someone"
                }
              />
            ) : null}

            {mayManage ? (
              <GrantProxy
                buildingSlug={buildingSlug}
                meetingId={meeting.id}
                units={units.map((unit) => ({ id: unit.id, label: unit.label }))}
                label="Record a proxy for another apartment"
              />
            ) : null}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="eyebrow border-limestone mb-3 border-b pb-2">Resolutions</h2>

        {meeting.resolutions.length === 0 ? (
          <p className="text-ironwork-soft mb-4 max-w-2xl text-sm">
            Nothing has been put to a vote at this meeting.
          </p>
        ) : (
          <ul className="mb-6 space-y-6">
            {meeting.resolutions.map((resolution) => {
              const outcome = outcomeOf(resolution, quorum.totalShares);

              return (
                <li key={resolution.id}>
                  <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-ironwork text-sm font-medium">
                      {resolution.title}
                    </h3>
                    <OutcomeChip passed={resolution.passed} />
                  </div>

                  <p className="text-ironwork-soft mb-2 max-w-2xl text-sm">
                    {resolution.text}
                  </p>

                  <p className="text-ironwork font-mono text-xs">
                    {resolution.sharesFor.toLocaleString("en-US")} for ·{" "}
                    {resolution.sharesAgainst.toLocaleString("en-US")} against ·{" "}
                    {resolution.sharesAbstain.toLocaleString("en-US")} abstaining
                  </p>
                  <p className="text-ironwork-faint mt-1 font-mono text-[0.6875rem]">
                    needed {outcome.threshold.label} of{" "}
                    {outcome.denominator.toLocaleString("en-US")} shares ={" "}
                    {outcome.needed.toLocaleString("en-US")}
                    {outcome.denominator > 0
                      ? ` · carried ${formatBasisPoints(weightOf(resolution.sharesFor, outcome.denominator))}`
                      : ""}
                  </p>

                  {resolution.votes.length > 0 ? (
                    <p className="text-ironwork-faint mt-1.5 font-mono text-[0.6875rem]">
                      {resolution.votes
                        .map(
                          (vote) =>
                            `${vote.unit.label} ${vote.choice.toLowerCase()}${vote.byProxy ? " (proxy)" : ""}`,
                        )
                        .join(" · ")}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}

        {mayManage && !adopted ? (
          <RecordResolution
            buildingSlug={buildingSlug}
            meetingId={meeting.id}
            voters={voters}
          />
        ) : null}
      </section>

      {meeting.workDecisions.length > 0 ? (
        <section className="mt-8">
          <h2 className="eyebrow border-limestone mb-3 border-b pb-2">
            Building work decided here
          </h2>
          <ul className="space-y-2">
            {meeting.workDecisions.map((decision) => (
              <li key={decision.id} className="text-sm">
                <Link
                  href={`/b/${buildingSlug}/work/${decision.id}`}
                  className="text-ironwork hover:text-verdigris underline-offset-4 hover:underline"
                >
                  {decision.title}
                </Link>
                <span className="text-ironwork-faint ml-2 font-mono text-[0.6875rem]">
                  {decision.decisionFor ?? 0}–{decision.decisionAgainst ?? 0}
                  {decision.assessmentTotalCents
                    ? ` · ${formatMoney(money(decision.assessmentTotalCents))} assessed`
                    : decision.estimateCents
                      ? ` · ${formatMoney(money(decision.estimateCents))} estimated`
                      : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-8">
        <h2 className="eyebrow border-limestone mb-3 border-b pb-2">Minutes</h2>

        {adopted ? (
          <p className="text-ironwork max-w-2xl text-sm whitespace-pre-line">
            {meeting.minutes}
          </p>
        ) : mayManage ? (
          <MinutesEditor
            buildingSlug={buildingSlug}
            meetingId={meeting.id}
            initial={meeting.minutes ?? ""}
          />
        ) : meeting.minutes ? (
          <>
            <p className="text-ironwork-faint mb-2 font-mono text-[0.6875rem]">
              Draft — not yet adopted by the board.
            </p>
            <p className="text-ironwork-soft max-w-2xl text-sm whitespace-pre-line">
              {meeting.minutes}
            </p>
          </>
        ) : (
          <p className="text-ironwork-soft text-sm">
            The secretary has not drafted the minutes for this meeting yet.
          </p>
        )}
      </section>
    </>
  );
}
