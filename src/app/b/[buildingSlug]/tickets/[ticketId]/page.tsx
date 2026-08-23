import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "~/components/patterns/PageHeader";
import { DocumentLink, UploadField } from "~/components/patterns/UploadField";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { primaryRole } from "~/lib/auth/roles";
import { getTicket, listAssignees, liveCharges } from "~/lib/db/scoped/tickets";
import { formatAmount, formatMoney, money } from "~/lib/money";
import { addMonths, formatDate, formatInstant, today, toPlainDate } from "~/lib/time";
import { ResponsibilityChip } from "../ResponsibilityChip";
import {
  ChargeTicket,
  DecideResponsibility,
  OpenDetermination,
  ResolveTicket,
  TicketComment,
  TicketControls,
} from "../TicketForms";

/**
 * One repair, from reported to paid for.
 *
 * The page is ordered the way the problem moves: what is wrong, who is dealing
 * with it, what was done, who pays, and only then the bill. The determination
 * sits between the work and the money on purpose — it is the step that makes
 * the last one legitimate, and putting it anywhere else would let the bill look
 * like the natural next click.
 */
export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ buildingSlug: string; ticketId: string }>;
}) {
  const { buildingSlug, ticketId } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const ticket = await getTicket(ctx, ticketId);
  if (!ticket) notFound();

  const mayTriage = can(ctx, "ticket.triage");
  const mayDecide = can(ctx, "ticket.decideResponsibility");
  const mayBill = can(ctx, "arrears.postCharge");
  const members = mayTriage ? await listAssignees(ctx) : [];

  const now = today(ctx.building.timezone);
  const decided = ticket.responsibility !== "UNDETERMINED";
  const charges = liveCharges(ticket.charges);
  const billed = charges.length > 0;
  const shareholderPays =
    ticket.responsibility === "SHAREHOLDER" || ticket.responsibility === "SHARED";

  const where = ticket.unit?.label ?? ticket.area ?? "somewhere shared";
  const handler =
    ticket.vendorName ?? ticket.assignee?.user.name ?? ticket.assignee?.user.email;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/b/${buildingSlug}/tickets`}
            className="hover:text-ironwork underline underline-offset-4"
          >
            Repairs
          </Link>
        }
        title={ticket.title}
        lede={`${where} · reported ${formatDate(toPlainDate(ticket.createdAt))} by ${
          ticket.reportedBy.user.name ?? ticket.reportedBy.user.email
        } · ${ticket.status.toLowerCase().replaceAll("_", " ")}${
          handler ? ` · with ${handler}` : ""
        }`}
      />

      <p className="text-ironwork mb-6 max-w-2xl text-sm whitespace-pre-line">
        {ticket.detail}
      </p>

      {ticket.priority === "URGENT" || ticket.priority === "EMERGENCY" ? (
        <p className="border-stamp bg-stamp-soft text-ironwork mb-6 border-l-2 px-3 py-2 text-sm">
          Reported as {ticket.priority.toLowerCase()}.
        </p>
      ) : null}

      {mayTriage ? (
        <div className="border-limestone mb-8 border-y py-4">
          <TicketControls
            buildingSlug={buildingSlug}
            ticketId={ticket.id}
            status={ticket.status}
            priority={ticket.priority}
            assigneeId={ticket.assignee?.id ?? null}
            vendorName={ticket.vendorName}
            vendorPhone={ticket.vendorPhone}
            members={members.map((member) => ({
              id: member.id,
              name: `${member.user.name ?? member.user.email}${
                member.title ? ` · ${member.title}` : ` · ${primaryRole(member.roles)}`
              }`,
            }))}
          />
        </div>
      ) : null}

      {/* ---- Photos ---- */}
      <section className="mt-8">
        <h2 className="eyebrow border-limestone mb-3 border-b pb-2">Photos</h2>

        {ticket.photos.length === 0 ? (
          <p className="text-ironwork-soft mb-3 max-w-2xl text-sm">
            Nothing attached. A photograph of the fault settles more arguments than a
            paragraph describing it.
          </p>
        ) : (
          <ul className="mb-3 space-y-1.5">
            {ticket.photos.map((photo) => (
              <li key={photo.id} className="text-sm">
                <DocumentLink
                  buildingSlug={buildingSlug}
                  documentId={photo.id}
                  title={photo.title}
                />
                <span className="text-ironwork-faint ml-2 font-mono text-[0.6875rem]">
                  {Math.round(photo.sizeBytes / 1024).toLocaleString("en-US")} KB
                  {photo.uploadedBy?.user.name
                    ? ` · ${photo.uploadedBy.user.name}`
                    : ""}
                </span>
              </li>
            ))}
          </ul>
        )}

        <UploadField
          buildingSlug={buildingSlug}
          entityType="TICKET"
          entityId={ticket.id}
          documentType="TICKET_PHOTO"
          label="Add a photo"
        />
      </section>

      {/* ---- What was done ---- */}
      <section className="mt-8">
        <h2 className="eyebrow border-limestone mb-3 border-b pb-2">What was done</h2>

        {ticket.resolutionNote ? (
          <>
            <p className="text-ironwork max-w-2xl text-sm whitespace-pre-line">
              {ticket.resolutionNote}
            </p>
            <p className="text-ironwork-faint mt-1.5 font-mono text-[0.6875rem]">
              {ticket.resolvedAt
                ? formatInstant(ticket.resolvedAt, ctx.building.timezone)
                : "—"}
              {ticket.resolvedBy?.user.name ? ` · ${ticket.resolvedBy.user.name}` : ""}
              {ticket.costCents != null
                ? ` · cost ${formatMoney(money(ticket.costCents))}`
                : ""}
            </p>
          </>
        ) : (
          <p className="text-ironwork-soft mb-3 max-w-2xl text-sm">
            Nothing recorded yet.
          </p>
        )}

        {mayTriage ? (
          <div className="mt-3">
            <ResolveTicket
              buildingSlug={buildingSlug}
              ticketId={ticket.id}
              initialNote={ticket.resolutionNote ?? ""}
              initialCost={
                ticket.costCents != null ? (ticket.costCents / 100).toFixed(2) : ""
              }
            />
          </div>
        ) : null}
      </section>

      {/* ---- Who pays ---- */}
      <section className="mt-8">
        <h2 className="eyebrow border-limestone mb-3 flex items-center gap-3 border-b pb-2">
          Who pays
          <ResponsibilityChip value={ticket.responsibility} />
        </h2>

        {ticket.approval ? (
          <>
            <p className="text-ironwork-soft text-sm">
              {ticket.approval.decidedAt ? (
                <>
                  Decided {formatDate(toPlainDate(ticket.approval.decidedAt))} by{" "}
                  {ticket.approval.decidedBy?.user.name ??
                    ticket.approval.decidedBy?.user.email ??
                    "the board"}
                  .
                </>
              ) : ticket.approval.status === "WITHDRAWN" ? (
                "The question was withdrawn."
              ) : (
                <>
                  Put to the board by{" "}
                  {ticket.approval.submittedBy?.user.name ??
                    ticket.approval.submittedBy?.user.email ??
                    "a member"}
                  . Not decided yet.
                </>
              )}
            </p>

            {ticket.approval.decisionNote ? (
              <p className="text-ironwork mt-1.5 max-w-2xl text-sm">
                {ticket.approval.decisionNote}
              </p>
            ) : null}
            {ticket.approval.conditions ? (
              <p className="text-ironwork mt-1.5 max-w-2xl text-sm">
                Conditions: {ticket.approval.conditions}
              </p>
            ) : null}

            {/* ---- The thread ---- */}
            {ticket.comments.length > 0 ? (
              <ul className="mt-4 space-y-3">
                {ticket.comments.map((comment) => (
                  <li
                    key={comment.id}
                    className={
                      comment.visibility === "BOARD_ONLY"
                        ? "border-brass border-l-2 pl-3"
                        : "border-limestone border-l-2 pl-3"
                    }
                  >
                    <p className="text-ironwork max-w-2xl text-sm whitespace-pre-line">
                      {comment.body}
                    </p>
                    <p className="text-ironwork-faint mt-1 font-mono text-[0.6875rem]">
                      {comment.author.user.name ?? comment.author.user.email} ·{" "}
                      {formatDate(toPlainDate(comment.createdAt))}
                      {comment.visibility === "BOARD_ONLY" ? " · board only" : ""}
                    </p>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 max-w-2xl">
              <TicketComment
                buildingSlug={buildingSlug}
                ticketId={ticket.id}
                canPostInternal={mayDecide}
              />
            </div>

            {mayDecide && !ticket.approval.decidedAt && !ticket.approval.withdrawnAt ? (
              <div className="mt-4">
                <DecideResponsibility
                  buildingSlug={buildingSlug}
                  ticketId={ticket.id}
                  hasUnit={ticket.unitId !== null}
                />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-ironwork-soft mb-3 max-w-2xl text-sm">
              Nobody has asked. Until the board decides in writing, this repair
              can&rsquo;t be billed to anyone — which is the protection working, not a
              missing feature.
            </p>
            <OpenDetermination buildingSlug={buildingSlug} ticketId={ticket.id} />
          </>
        )}
      </section>

      {/* ---- The bill ---- */}
      {ticket.unitId ? (
        <section className="border-limestone mt-8 border-t pt-6">
          <h2 className="eyebrow mb-3">The bill</h2>

          {billed ? (
            <>
              <ul className="space-y-1.5">
                {charges.map((charge) => (
                  <li key={charge.id} className="text-ironwork text-sm">
                    <span className="font-mono">
                      {formatAmount(money(charge.amountCents))}
                    </span>{" "}
                    on {charge.unit.label}&rsquo;s ledger, due{" "}
                    {formatDate(toPlainDate(charge.dueOn))}
                  </li>
                ))}
              </ul>
              <p className="text-ironwork-faint mt-2 max-w-2xl text-xs leading-relaxed">
                Correcting this means a reversing entry against it on{" "}
                <Link
                  href={`/b/${buildingSlug}/arrears/${ticket.unitId}`}
                  className="text-verdigris underline underline-offset-4"
                >
                  the apartment&rsquo;s ledger
                </Link>
                , not an edit — so both the error and the correction stay where a
                shareholder disputing the bill can see them.
              </p>
            </>
          ) : !decided ? (
            <p className="text-ironwork-faint max-w-2xl text-xs leading-relaxed">
              Nothing can be billed until the board has recorded who pays.
            </p>
          ) : !shareholderPays ? (
            <p className="text-ironwork-faint max-w-2xl text-xs leading-relaxed">
              The board determined this one is the corporation&rsquo;s, so there is
              nothing to bill the apartment for.
            </p>
          ) : mayBill ? (
            <>
              <p className="text-ironwork-soft mb-4 max-w-2xl text-sm">
                The board determined{" "}
                {ticket.responsibility === "SHARED"
                  ? "the cost is shared"
                  : `${ticket.unit?.label} is responsible`}
                . This puts it on the apartment&rsquo;s ledger, and can only be done
                once.
              </p>
              <ChargeTicket
                buildingSlug={buildingSlug}
                ticketId={ticket.id}
                unitLabel={ticket.unit?.label ?? "the apartment"}
                defaultAmount={
                  ticket.costCents != null ? (ticket.costCents / 100).toFixed(2) : ""
                }
                defaultDueOn={`${addMonths(now, 1).slice(0, 7)}-01`}
              />
            </>
          ) : (
            <p className="text-ironwork-faint max-w-2xl text-xs leading-relaxed">
              The board determined this is the shareholder&rsquo;s. Only the treasurer
              can put it on a ledger.
            </p>
          )}
        </section>
      ) : null}
    </>
  );
}
