import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { ScaffoldNotice } from "~/components/patterns/ScaffoldNotice";
import { getBuildingContext } from "~/lib/auth/current";
import { listNoticeCampaigns, listNoticeDeliveries } from "~/lib/db/scoped/modules";
import { formatDate, toPlainDate } from "~/lib/time";

export const MISSING = [
  "Generating each notice from a React Email template",
  "Sending, through the notification log",
  "Recording responses, and chasing the households that don't reply",
  "Proof of delivery: the signed card, the photo under the door",
];

/**
 * Annual notices — scaffold.
 *
 * The value of this module is evidence. When a shareholder says they never got
 * the window guard notice, the building needs to show what was sent, to whom
 * and when — which is what the notification log from M2 exists for. The
 * delivery rows below already carry a slot for that record.
 */
export default async function NoticesPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const [campaigns, deliveries] = await Promise.all([
    listNoticeCampaigns(ctx),
    listNoticeDeliveries(ctx),
  ]);

  const outstanding = deliveries.filter((d) => !d.respondedAt).length;

  return (
    <>
      <PageHeader
        eyebrow="Annual notices"
        title={
          outstanding === 0
            ? "Every household has replied"
            : `${outstanding} ${outstanding === 1 ? "household hasn't" : "households haven't"} replied`
        }
        lede="Window guard, lead paint, stove knob covers. The law requires them yearly, and requires the building to keep the proof."
      />

      <ScaffoldNotice missing={MISSING} />

      {campaigns.length === 0 ? (
        <EmptyState title="No notices sent yet">
          The January annual notices are generated from the compliance calendar.
        </EmptyState>
      ) : (
        <ul className="space-y-4">
          {campaigns.map((campaign) => {
            const rows = deliveries.filter((d) => d.campaignId === campaign.id);
            const replied = rows.filter((d) => d.respondedAt).length;

            return (
              <li key={campaign.id} className="sheet px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-sm font-medium text-ironwork">
                    {campaign.noticeType.toLowerCase().replaceAll("_", " ")} · {campaign.year}
                  </span>
                  <span className="font-mono text-xs text-ironwork-soft">
                    due {formatDate(toPlainDate(campaign.dueOn))}
                  </span>
                </div>
                <p className="mt-1 font-mono text-[0.6875rem] text-ironwork-faint">
                  {campaign.sentAt ? "sent" : "not sent"} · {replied} of {rows.length}{" "}
                  households replied
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
