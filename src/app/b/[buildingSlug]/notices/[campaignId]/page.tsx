import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { getCampaign, noticeLog } from "~/lib/db/scoped/notices";
import { mayAnswerFor } from "~/lib/db/scoped/notice-writes";
import { describeReason } from "~/lib/primitives/notices";
import { formatDate, formatInstant, today, toPlainDate } from "~/lib/time";
import {
  CloseCampaign,
  RecordDelivery,
  RecordResponse,
  SendCampaign,
} from "../NoticeForms";

/**
 * One notice, apartment by apartment.
 *
 * Arranged around the question a board has to answer at the end of the year:
 * *what did this leave us owing?* So the apartments the building must act on
 * come first, with the reason written next to each — answered yes, asked for
 * it, or never answered at all — and the reason is the same sentence that ends
 * up on the compliance calendar when the campaign is closed.
 *
 * The log at the bottom is the evidence. It carries the address each notice
 * went to and the text of what was sent, verbatim, because "we sent it" is not
 * a defence and "here is what went to that address on the fourth of January" is.
 */
export default async function CampaignPage({
  params,
}: {
  params: Promise<{ buildingSlug: string; campaignId: string }>;
}) {
  const { buildingSlug, campaignId } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const campaign = await getCampaign(ctx, campaignId);
  if (!campaign) notFound();

  const maySend = can(ctx, "notice.send");
  const log = await noticeLog(ctx, campaignId);
  const { spec, standing } = campaign;

  const owed = campaign.deliveries.filter((row) => row.reason !== null);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href={`/b/${buildingSlug}/notices`} className="hover:text-verdigris">
            Annual notices
          </Link>
        }
        title={`${spec.title} · ${campaign.year}`}
        lede={spec.question}
      />

      <div className="border-limestone mb-6 border-b pb-4">
        <p className="text-ironwork-soft text-sm">
          {campaign.closedAt
            ? `Closed ${formatDate(toPlainDate(campaign.closedAt))}${campaign.closedBy ? ` by ${campaign.closedBy}` : ""}. What it left outstanding is on the compliance calendar.`
            : campaign.sentAt
              ? `Sent ${formatDate(toPlainDate(campaign.sentAt))}. Households have until ${campaign.respondBy ? formatDate(toPlainDate(campaign.respondBy)) : "the reply-by date"} to answer.`
              : `Has to go out by ${formatDate(toPlainDate(campaign.dueOn))}. Nothing has been sent yet.`}
        </p>
        <p className="text-ironwork-faint mt-1.5 font-mono text-[0.6875rem]">
          {spec.citation}
        </p>
      </div>

      {/* --- What the building owes ---------------------------------------- */}
      <section className="mb-8">
        <h2 className="border-limestone mb-3 border-b pb-2 text-lg font-semibold tracking-tight">
          {standing.owedWork === 0
            ? "Nothing outstanding"
            : `${standing.owedWork} ${standing.owedWork === 1 ? "apartment" : "apartments"} to be seen to`}
        </h2>

        {standing.owedWork === 0 ? (
          <p className="text-ironwork-soft text-sm">
            {campaign.deadlinePassed
              ? "Every household answered, and none of them needs anything."
              : "Nothing so far. Apartments that never reply will appear here once the reply-by date passes."}
          </p>
        ) : (
          <>
            <ul className="divide-limestone border-limestone divide-y border-y">
              {owed.map((row) => (
                <li key={row.id} className="py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                    <span className="text-ironwork text-sm">{row.unitLabel}</span>
                    {row.obligationId ? (
                      <span className="text-complete font-mono text-[0.6875rem]">
                        on the calendar
                      </span>
                    ) : (
                      <span className="text-stamp font-mono text-[0.6875rem]">
                        not booked yet
                      </span>
                    )}
                  </div>
                  <p className="text-ironwork-soft mt-0.5 text-xs">
                    {describeReason(campaign.noticeType, row.reason!)}
                  </p>
                </li>
              ))}
            </ul>

            {!campaign.deadlinePassed ? (
              <p className="text-ironwork-faint mt-3 text-xs leading-relaxed">
                Apartments that have not answered are not on this list yet — they have
                until{" "}
                {campaign.respondBy
                  ? formatDate(toPlainDate(campaign.respondBy))
                  : "the reply-by date"}
                .
              </p>
            ) : null}
          </>
        )}

        {maySend && !campaign.closedAt && campaign.deadlinePassed ? (
          <div className="mt-4">
            <CloseCampaign
              buildingSlug={buildingSlug}
              campaignId={campaign.id}
              willCreate={owed.filter((row) => !row.obligationId).length}
              noticeType={campaign.noticeType}
            />
          </div>
        ) : null}
      </section>

      {/* --- Every apartment ------------------------------------------------ */}
      <section className="mb-8">
        <h2 className="border-limestone mb-3 border-b pb-2 text-lg font-semibold tracking-tight">
          Every apartment
        </h2>

        <ul className="divide-limestone border-limestone divide-y border-b">
          {campaign.deliveries.map((row) => (
            <li key={row.id} className="py-3">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                <span className="text-ironwork text-sm">
                  {row.unitLabel}
                  {row.visible && row.recipientName !== row.unitLabel ? (
                    <span className="text-ironwork-soft ml-2">{row.recipientName}</span>
                  ) : null}
                </span>
                <span className="text-ironwork-faint font-mono text-[0.6875rem]">
                  {row.sentAt
                    ? `${(row.method ?? "sent").toLowerCase()} · ${formatDate(toPlainDate(row.sentAt))}`
                    : "not sent"}
                  {row.bounced ? " · bounced" : ""}
                </span>
              </div>

              <p className="text-ironwork-soft mt-0.5 text-xs">
                {row.respondedAt
                  ? row.visible && row.response
                    ? `${spec.answers[row.response.answer]}${row.response.note ? ` — ${row.response.note}` : ""}`
                    : `Answered ${formatDate(toPlainDate(row.respondedAt))}.`
                  : row.sentAt
                    ? "No answer yet."
                    : "Nothing has gone to this apartment."}
                {row.visible && row.recordedBy && row.respondedAt
                  ? ` Recorded by ${row.recordedBy}.`
                  : ""}
              </p>

              {!campaign.closedAt ? (
                <div className="mt-2 flex flex-wrap gap-3">
                  {maySend && !row.sentAt ? (
                    <RecordDelivery
                      buildingSlug={buildingSlug}
                      campaignId={campaign.id}
                      deliveryId={row.id}
                      unitLabel={row.unitLabel}
                      today={now}
                    />
                  ) : null}

                  {row.sentAt && !row.respondedAt && mayAnswerFor(ctx, row.unitId) ? (
                    <RecordResponse
                      buildingSlug={buildingSlug}
                      campaignId={campaign.id}
                      deliveryId={row.id}
                      unitLabel={row.unitLabel}
                      noticeType={campaign.noticeType}
                      today={now}
                    />
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        {maySend && !campaign.closedAt ? (
          <div className="mt-4">
            <SendCampaign
              buildingSlug={buildingSlug}
              campaignId={campaign.id}
              alreadySent={campaign.sentAt !== null}
            />
          </div>
        ) : null}
      </section>

      {/* --- What was sent -------------------------------------------------- */}
      {log.length > 0 ? (
        <section>
          <h2 className="border-limestone mb-3 border-b pb-2 text-lg font-semibold tracking-tight">
            What was sent
          </h2>
          <p className="text-ironwork-soft mb-3 text-sm">
            Written down before each message was handed to the provider, and kept
            verbatim. This is what the building produces when somebody says they never
            received it.
          </p>

          <ul className="space-y-2">
            {log.map((entry) => (
              <li key={entry.id} className="sheet px-3 py-2.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4">
                  <span className="text-ironwork font-mono text-xs">
                    {entry.recipientEmail}
                  </span>
                  <span
                    className={
                      entry.status === "BOUNCED" || entry.status === "FAILED"
                        ? "text-stamp font-mono text-[0.6875rem]"
                        : "text-ironwork-faint font-mono text-[0.6875rem]"
                    }
                  >
                    {entry.status.toLowerCase()} ·{" "}
                    {formatInstant(
                      entry.sentAt ?? entry.queuedAt,
                      ctx.building.timezone,
                    )}
                  </span>
                </div>
                {entry.lastError ? (
                  <p className="text-stamp mt-1 text-xs">{entry.lastError}</p>
                ) : null}
                <details className="mt-1.5">
                  <summary className="text-ironwork-soft cursor-pointer text-xs">
                    {entry.subject}
                  </summary>
                  <pre className="text-ironwork-soft mt-2 overflow-x-auto font-mono text-[0.6875rem] whitespace-pre-wrap">
                    {entry.textBody}
                  </pre>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
