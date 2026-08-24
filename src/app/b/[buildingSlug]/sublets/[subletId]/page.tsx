import Link from "next/link";
import { notFound } from "next/navigation";
import { CapMeter } from "~/components/patterns/CapMeter";
import { PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import {
  getSublet,
  isActiveOn,
  isApproved,
  liveCharges,
  subletCap,
} from "~/lib/db/scoped/sublets";
import { formatAmount, formatMoney, money } from "~/lib/money";
import { availableActions, type ApprovalStatus } from "~/lib/primitives/approvals";
import { addMonths, addYears, formatDate, today, toPlainDate } from "~/lib/time";
import { ApprovalChip } from "../../alterations/ApprovalChip";
import {
  EndSublet,
  PostSubletFee,
  RenewSublet,
  SubletComment,
  SubletDecision,
} from "../SubletForms";

/**
 * One sublet application, and what the board did about it.
 *
 * The cap reading sits next to the decision rather than at the top, because
 * that is the moment it matters: the board is about to approve or refuse, and
 * the question "would this put us over" should be answerable without leaving
 * the page. It is read as of the term's start date, which is the date the write
 * path checks — the page and the rule are looking at the same number.
 */
export default async function SubletDetailPage({
  params,
}: {
  params: Promise<{ buildingSlug: string; subletId: string }>;
}) {
  const { buildingSlug, subletId } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const sublet = await getSublet(ctx, subletId);
  if (!sublet) notFound();

  const now = today(ctx.building.timezone);
  const startsOn = toPlainDate(sublet.termStart);
  const endsOn = toPlainDate(sublet.termEnd);

  // As of the term's start, exactly as the write path counts it.
  const cap = await subletCap(ctx, startsOn);

  const mayDecide = can(ctx, "sublet.decide");
  const mayBill = can(ctx, "arrears.postCharge");
  const isMine = ctx.unitIds.includes(sublet.unitId);

  const status = (sublet.approval?.status ?? "DRAFT") as ApprovalStatus;
  const decided = Boolean(sublet.approval?.decidedAt);
  const approved = isApproved(sublet);
  const running = isActiveOn(sublet, now);
  const charges = liveCharges(sublet.charges);

  const actions = sublet.approval
    ? availableActions({
        status,
        isSubmitter: sublet.approval.submittedById === ctx.membership.id,
        canDecide: mayDecide,
      })
    : [];

  // If approving is on the table but the cap has no room, say so before they
  // press it rather than only after.
  const wouldBreachCap =
    !decided &&
    mayDecide &&
    !cap.roomForOneMore &&
    cap.capPercent !== null &&
    !approved;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/b/${buildingSlug}/sublets`}
            className="hover:text-ironwork underline underline-offset-4"
          >
            Sublet register
          </Link>
        }
        title={`${sublet.unit.label} — ${sublet.subtenantName}`}
        lede={`${formatDate(startsOn)} to ${formatDate(endsOn)}${
          sublet.endedOn
            ? ` · ended early on ${formatDate(toPlainDate(sublet.endedOn))}`
            : running
              ? " · in occupation now"
              : ""
        }`}
        actions={<ApprovalChip status={status} />}
      />

      {sublet.renewedFromId ? (
        <p className="text-ironwork-faint mb-6 text-xs">
          Renews{" "}
          <Link
            href={`/b/${buildingSlug}/sublets/${sublet.renewedFromId}`}
            className="text-verdigris underline underline-offset-4"
          >
            an earlier sublet
          </Link>{" "}
          of this apartment.
        </p>
      ) : null}

      {sublet.subtenantContact ? (
        <p className="text-ironwork-soft mb-6 text-sm">
          Reach {sublet.subtenantName} at {sublet.subtenantContact}.
        </p>
      ) : null}

      {sublet.endedOn ? (
        <p className="border-limestone-deep text-ironwork mb-6 max-w-2xl border-l-2 px-3 py-2 text-sm">
          Ended early on {formatDate(toPlainDate(sublet.endedOn))}
          {sublet.endedReason ? ` — ${sublet.endedReason}` : ""}
          {sublet.endedBy?.user.name ? `, recorded by ${sublet.endedBy.user.name}` : ""}
          . The apartment&rsquo;s slot under the cap was freed from that day.
        </p>
      ) : null}

      {/* ---- The decision ---- */}
      <section>
        <h2 className="eyebrow border-limestone mb-3 border-b pb-2">
          The board&rsquo;s decision
        </h2>

        {decided ? (
          <>
            <p className="text-ironwork-soft text-sm">
              {approved ? "Approved" : "Denied"}{" "}
              {sublet.approval?.decidedAt
                ? formatDate(toPlainDate(sublet.approval.decidedAt))
                : ""}{" "}
              by{" "}
              {sublet.approval?.decidedBy?.user.name ??
                sublet.approval?.decidedBy?.user.email ??
                "the board"}
              .
            </p>
            {sublet.approval?.decisionNote ? (
              <p className="text-ironwork mt-1.5 max-w-2xl text-sm">
                {sublet.approval.decisionNote}
              </p>
            ) : null}
            {sublet.approval?.conditions ? (
              <p className="text-ironwork mt-1.5 max-w-2xl text-sm">
                Conditions: {sublet.approval.conditions}
              </p>
            ) : null}
          </>
        ) : status === "WITHDRAWN" ? (
          <p className="text-ironwork-soft text-sm">
            The application was withdrawn. A new one can be filed at any time.
          </p>
        ) : (
          <p className="text-ironwork-soft text-sm">
            Filed by{" "}
            {sublet.approval?.submittedBy?.user.name ??
              sublet.approval?.submittedBy?.user.email ??
              "a member"}
            {sublet.approval?.submittedAt
              ? ` on ${formatDate(toPlainDate(sublet.approval.submittedAt))}`
              : ""}
            . Not decided yet.
          </p>
        )}

        {/* The cap, next to the decision, as of the day the subtenant moves in. */}
        {!decided && mayDecide ? (
          <div className="mt-4 max-w-xl">
            <p className="text-ironwork-faint mb-2 font-mono text-[0.6875rem]">
              As it would stand on {formatDate(startsOn)}
            </p>
            <CapMeter cap={cap} />
          </div>
        ) : null}

        <div className="mt-4">
          <SubletDecision
            buildingSlug={buildingSlug}
            subletId={sublet.id}
            actions={actions}
            capWarning={
              wouldBreachCap
                ? `The lease allows ${cap.allowed} of ${cap.totalUnits} apartments to be sublet at once, and ${cap.current} already ${cap.current === 1 ? "is" : "are"} on ${formatDate(startsOn)}. Approving this would put the building over its cap, and will be refused.`
                : null
            }
          />
        </div>
      </section>

      {/* ---- The thread ---- */}
      {sublet.approval ? (
        <section className="mt-8">
          <h2 className="eyebrow border-limestone mb-3 border-b pb-2">The thread</h2>

          {sublet.comments.length === 0 ? (
            <p className="text-ironwork-soft mb-3 text-sm">Nothing said yet.</p>
          ) : (
            <ul className="mb-4 space-y-3">
              {sublet.comments.map((comment) => (
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
          )}

          <div className="max-w-2xl">
            <SubletComment
              buildingSlug={buildingSlug}
              subletId={sublet.id}
              canPostInternal={mayDecide}
            />
          </div>
        </section>
      ) : null}

      {/* ---- The fee ---- */}
      <section className="mt-8">
        <h2 className="eyebrow border-limestone mb-3 border-b pb-2">The fee</h2>

        {charges.length > 0 ? (
          <>
            <ul className="space-y-1.5">
              {charges.map((charge) => (
                <li key={charge.id} className="text-ironwork text-sm">
                  <span className="font-mono">
                    {formatAmount(money(charge.amountCents))}
                  </span>{" "}
                  on {sublet.unit.label}&rsquo;s ledger, due{" "}
                  {formatDate(toPlainDate(charge.dueOn))}
                </li>
              ))}
            </ul>
            <p className="text-ironwork-faint mt-2 max-w-2xl text-xs leading-relaxed">
              Correcting this means a reversing entry on{" "}
              <Link
                href={`/b/${buildingSlug}/arrears/${sublet.unitId}`}
                className="text-verdigris underline underline-offset-4"
              >
                the apartment&rsquo;s ledger
              </Link>
              , not an edit.
            </p>
          </>
        ) : !approved ? (
          <p className="text-ironwork-faint max-w-2xl text-xs leading-relaxed">
            Nothing can be charged until the board has approved the sublet. Billing a
            shareholder for permission they have not been given is the wrong way round.
          </p>
        ) : mayBill ? (
          <>
            <p className="text-ironwork-soft mb-4 max-w-2xl text-sm">
              The agreed fee is {formatMoney(money(sublet.feeCents))}. This posts it to{" "}
              {sublet.unit.label}&rsquo;s ledger, and can only be done once.
            </p>
            <PostSubletFee
              buildingSlug={buildingSlug}
              subletId={sublet.id}
              unitLabel={sublet.unit.label}
              defaultAmount={(sublet.feeCents / 100).toFixed(2)}
              defaultDueOn={`${addMonths(now, 1).slice(0, 7)}-01`}
            />
          </>
        ) : (
          <p className="text-ironwork-faint max-w-2xl text-xs leading-relaxed">
            The fee has not been charged yet. Only the treasurer can put it on a ledger.
          </p>
        )}
      </section>

      {/* ---- Ending and renewing ---- */}
      {approved && !sublet.endedOn ? (
        <section className="border-limestone mt-8 border-t pt-6">
          <h2 className="eyebrow mb-3">Before it runs out</h2>
          <p className="text-ironwork-soft mb-4 max-w-2xl text-sm">
            {sublet.obligationId ? (
              <>
                The end of the term is on the compliance calendar, so a reminder goes
                out sixty days before {formatDate(endsOn)}. A sublet that quietly runs
                past its term is a subtenant in occupation without permission, and that
                is the corporation&rsquo;s problem rather than the shareholder&rsquo;s.
              </>
            ) : (
              <>The term ends {formatDate(endsOn)}.</>
            )}
          </p>

          <div className="flex flex-wrap gap-3">
            {isMine || can(ctx, "sublet.viewAll") ? (
              <RenewSublet
                buildingSlug={buildingSlug}
                subletId={sublet.id}
                defaultEnd={addYears(endsOn, 1)}
              />
            ) : null}
            {mayDecide ? (
              <EndSublet
                buildingSlug={buildingSlug}
                subletId={sublet.id}
                defaultDate={now}
              />
            ) : null}
          </div>

          {sublet.renewals.length > 0 ? (
            <p className="text-ironwork-faint mt-4 text-xs">
              Already renewed —{" "}
              <Link
                href={`/b/${buildingSlug}/sublets/${sublet.renewals[0]!.id}`}
                className="text-verdigris underline underline-offset-4"
              >
                see the later term
              </Link>
              .
            </p>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
