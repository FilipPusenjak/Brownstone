import Link from "next/link";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { listCampaigns } from "~/lib/db/scoped/notices";
import { NOTICES, type NoticeType } from "~/lib/primitives/notices";
import { formatDate, makeDate, today, toPlainDate, yearOf } from "~/lib/time";
import { OpenCampaign } from "./NoticeForms";

/**
 * The annual notices.
 *
 * The headline is not how many replies came back. It is how many apartments
 * the building now owes work to — which, once the reply-by date has passed,
 * includes every household that said nothing at all. A board reading "nine of
 * twelve replied" concludes it is nearly done; a board reading "five apartments
 * to be seen to" knows what the year actually left it with.
 */
export default async function NoticesPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);
  const year = yearOf(now);

  const campaigns = await listCampaigns(ctx);
  const maySend = can(ctx, "notice.send");

  const thisYear = campaigns.filter((campaign) => campaign.year === year);
  const owed = campaigns
    .filter((campaign) => !campaign.closedAt)
    .reduce((sum, campaign) => sum + campaign.standing.owedWork, 0);

  return (
    <>
      <PageHeader
        eyebrow="Annual notices"
        title={
          owed === 0
            ? "Nothing outstanding on this year's notices"
            : `${owed} ${owed === 1 ? "apartment is" : "apartments are"} owed work from a notice`
        }
        lede="Window guard, lead paint, stove knob covers. The law requires them yearly, requires the building to keep the proof — and does not let an apartment that never replied stand as a no."
        actions={
          maySend ? (
            <OpenCampaign
              buildingSlug={buildingSlug}
              year={year}
              defaultDueOn={makeDate(year, 1, 15)}
              defaultRespondBy={makeDate(year, 2, 14)}
              taken={thisYear.map((campaign) => campaign.noticeType)}
            />
          ) : null
        }
      />

      {campaigns.length === 0 ? (
        <EmptyState title="No notices opened yet">
          {maySend
            ? "Open this year's window guard notice and Co-operator will list every apartment it has to reach."
            : "Once the board opens this year's notices, they will appear here."}
        </EmptyState>
      ) : (
        <ul className="space-y-3">
          {campaigns.map((campaign) => {
            const spec = NOTICES[campaign.noticeType as NoticeType];
            const standing = campaign.standing;

            return (
              <li key={campaign.id}>
                <Link
                  href={`/b/${buildingSlug}/notices/${campaign.id}`}
                  className="sheet hover:border-verdigris block px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-ironwork text-sm font-medium">
                      {spec.title} · {campaign.year}
                    </span>
                    <span className="text-ironwork-soft font-mono text-xs">
                      {campaign.closedAt
                        ? `closed ${formatDate(toPlainDate(campaign.closedAt))}`
                        : campaign.sentAt
                          ? `sent ${formatDate(toPlainDate(campaign.sentAt))}`
                          : "not sent"}
                    </span>
                  </div>

                  <p className="text-ironwork-soft mt-1.5 text-sm">
                    {describeStanding(campaign)}
                  </p>

                  <p className="text-ironwork-faint mt-1 font-mono text-[0.6875rem]">
                    {standing.answered} of {standing.total} answered
                    {standing.notSent > 0 ? ` · ${standing.notSent} not sent` : ""}
                    {campaign.respondBy && !campaign.closedAt
                      ? ` · reply by ${formatDate(toPlainDate(campaign.respondBy))}`
                      : ""}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

/** The sentence a board should read first, in the state the campaign is in. */
function describeStanding(campaign: {
  closedAt: Date | null;
  sentAt: Date | null;
  deadlinePassed: boolean;
  standing: {
    total: number;
    notSent: number;
    silent: number;
    owedWork: number;
    everyoneHeard: boolean;
  };
}): string {
  const { standing } = campaign;

  if (campaign.closedAt) {
    return standing.owedWork === 0
      ? "Closed with nothing outstanding."
      : `Closed. ${standing.owedWork} ${standing.owedWork === 1 ? "apartment is" : "apartments are"} on the calendar to be seen to.`;
  }

  if (!standing.everyoneHeard) {
    return `${standing.notSent} ${standing.notSent === 1 ? "apartment has" : "apartments have"} not been sent it yet.`;
  }

  if (!campaign.deadlinePassed) {
    return standing.silent === 0
      ? "Every household has answered."
      : `${standing.silent} still to answer, and time to do it.`;
  }

  return standing.owedWork === 0
    ? "Everyone answered, and nobody needs anything. Ready to close."
    : `${standing.owedWork} ${standing.owedWork === 1 ? "apartment" : "apartments"} to be seen to — close it out to put the work on the calendar.`;
}
