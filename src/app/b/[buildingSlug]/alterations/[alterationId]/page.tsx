import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { getAlteration } from "~/lib/db/scoped/alterations";
import { DECIDE_CAPABILITY, availableActions } from "~/lib/primitives/approvals";
import { formatDate, formatInstant, toPlainDate } from "~/lib/time";
import { formatMoney, money } from "~/lib/money";
import { AlterationPanel, CommentBox } from "../AlterationPanel";
import { ApprovalChip } from "../ApprovalChip";
import { CertificateForm } from "../CertificateForm";
import { DocumentLink, UploadField } from "../UploadField";

export default async function AlterationPage({
  params,
}: {
  params: Promise<{ buildingSlug: string; alterationId: string }>;
}) {
  const { buildingSlug, alterationId } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const alteration = await getAlteration(ctx, alterationId);
  if (!alteration) notFound();

  const approval = alteration.approval;
  const capability = DECIDE_CAPABILITY["ALTERATION"];

  // Computed on the server from the shared state machine, so the interface can
  // never offer an action the server would refuse.
  const actions = availableActions({
    status: approval.status,
    isSubmitter: approval.submittedById === ctx.membership.id,
    canDecide: capability ? can(ctx, capability) : false,
  });

  const flags = [
    alteration.wetOverDry ? "Wet over dry" : null,
    alteration.affectsStructure ? "Touches structure" : null,
    alteration.affectsRiser ? "Touches the riser" : null,
    alteration.requiresDobPermit ? "Needs a DOB permit" : null,
  ].filter(Boolean) as string[];

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/b/${buildingSlug}/alterations`}
            className="underline underline-offset-4"
          >
            Alterations
          </Link>
        }
        title={alteration.title}
        lede={alteration.scope}
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <ApprovalChip status={approval.status} />
        <span className="font-mono text-sm text-ironwork">
          {alteration.unit.label}
        </span>
        <span className="text-sm text-ironwork-soft">
          filed by {approval.submittedBy.user.name ?? approval.submittedBy.user.email}
          {approval.submittedAt
            ? ` on ${formatDate(toPlainDate(approval.submittedAt))}`
            : ""}
        </span>
      </div>

      {flags.length > 0 ? (
        <ul className="mb-6 flex flex-wrap gap-2">
          {flags.map((flag) => (
            <li
              key={flag}
              className="rounded-chip border border-limestone-deep px-2 py-0.5 font-mono text-[0.6875rem] uppercase tracking-wider text-ironwork-soft"
            >
              {flag}
            </li>
          ))}
        </ul>
      ) : null}

      {approval.decidedAt ? (
        <section className="mb-8 border-l-2 border-limestone-deep bg-paper px-4 py-3">
          <p className="eyebrow mb-1">The decision</p>
          <p className="text-sm text-ironwork">
            {approval.status === "DENIED" ? "Denied" : "Approved"} by{" "}
            {approval.decidedBy?.user.name ?? approval.decidedBy?.user.email ?? "—"} on{" "}
            {formatInstant(approval.decidedAt, ctx.building.timezone)}.
          </p>
          {approval.conditions ? (
            <p className="mt-2 text-sm text-ironwork">
              <strong className="font-medium">Conditions:</strong> {approval.conditions}
            </p>
          ) : null}
          {approval.decisionNote ? (
            <p className="mt-2 text-sm text-ironwork-soft">{approval.decisionNote}</p>
          ) : null}
        </section>
      ) : null}

      <AlterationPanel
        buildingSlug={buildingSlug}
        alterationId={alteration.id}
        actions={actions}
      />

      <dl className="grid gap-x-8 gap-y-4 border-t border-limestone pt-6 sm:grid-cols-2">
        <Row label="Contractor" value={alteration.contractorName ?? "Not named yet"} />
        <Row
          label="Licence"
          value={alteration.contractorLicense ?? "—"}
          mono
        />
        <Row
          label="Planned"
          value={
            alteration.plannedStart
              ? `${formatDate(toPlainDate(alteration.plannedStart))}${
                  alteration.plannedEnd
                    ? ` — ${formatDate(toPlainDate(alteration.plannedEnd))}`
                    : ""
                }`
              : "No dates yet"
          }
          mono
        />
        <Row label="DOB job number" value={alteration.dobJobNumber ?? "—"} mono />
      </dl>

      <section className="mt-8 border-t border-limestone pt-6">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Insurance</h2>
          {can(ctx, "coi.manage") ? (
            <CertificateForm
              buildingSlug={buildingSlug}
              alterationId={alteration.id}
              unitId={alteration.unitId}
              defaultHolderName={alteration.contractorName}
            />
          ) : null}
        </div>

        {alteration.certificates.length === 0 ? (
          <p className="text-sm text-ironwork-soft">
            No certificate on file. Work should not start until the contractor&rsquo;s
            insurer names the corporation as an additional insured.
          </p>
        ) : (
          <ul className="divide-y divide-limestone border-t border-limestone">
            {alteration.certificates.map((certificate) => (
              <li key={certificate.id} className="py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-sm font-medium text-ironwork">
                    {certificate.holderName}
                  </span>
                  <span className="font-mono text-xs text-ironwork-soft">
                    expires {formatDate(toPlainDate(certificate.expiresOn))}
                  </span>
                </div>
                <p className="mt-0.5 font-mono text-[0.6875rem] text-ironwork-faint">
                  {certificate.carrier} · {certificate.policyNumber}
                  {certificate.coverageCents
                    ? ` · ${formatMoney(money(certificate.coverageCents))}`
                    : ""}
                </p>
                {certificate.additionalInsuredVerified ? (
                  <p className="mt-1 text-xs text-ironwork-soft">
                    Corporation named as additional insured.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-stamp">
                    The corporation is not named as an additional insured. Ask the
                    broker to reissue it.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8 border-t border-limestone pt-6">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Plans and documents</h2>
        <UploadField
          buildingSlug={buildingSlug}
          entityType="ALTERATION_REQUEST"
          entityId={alteration.id}
          documentType="ALTERATION_PLAN"
          label="Add a plan, a licence, or a certificate"
        />
      </section>

      <section className="mt-8 border-t border-limestone pt-6">
        <h2 className="mb-3 text-lg font-semibold tracking-tight">Discussion</h2>
        {approval.comments.length === 0 ? (
          <p className="text-sm text-ironwork-soft">Nothing said yet.</p>
        ) : (
          <ul className="space-y-4">
            {approval.comments.map((comment) => (
              <li
                key={comment.id}
                className={`border-l-2 pl-3 ${
                  comment.visibility === "BOARD_ONLY"
                    ? "border-brass"
                    : "border-limestone"
                }`}
              >
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-sm font-medium text-ironwork">
                    {comment.author.user.name ?? comment.author.user.email}
                  </span>
                  <span className="font-mono text-[0.6875rem] text-ironwork-faint">
                    {formatInstant(comment.createdAt, ctx.building.timezone)}
                  </span>
                  {comment.visibility === "BOARD_ONLY" ? (
                    <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-brass">
                      Board only
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-ironwork-soft">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}

        {can(ctx, "alteration.comment") ? (
          <CommentBox
            buildingSlug={buildingSlug}
            alterationId={alteration.id}
            canCommentInternally={can(ctx, "alteration.commentInternal")}
          />
        ) : null}
      </section>
    </>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="eyebrow mb-0.5">{label}</dt>
      <dd className={`text-sm text-ironwork ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

export { DocumentLink };
