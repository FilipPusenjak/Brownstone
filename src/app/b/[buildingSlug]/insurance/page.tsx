import Link from "next/link";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { StatusChip } from "~/components/patterns/StatusChip";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { listCertificates } from "~/lib/db/scoped/documents";
import { formatMoney, money } from "~/lib/money";
import { dueStatus } from "~/lib/primitives/obligations/recurrence";
import { formatDate, relativeDays, today, toPlainDate } from "~/lib/time";
import { CertificateForm } from "../alterations/CertificateForm";

/**
 * Certificates of insurance.
 *
 * The whole value of tracking these is the alert, so the list is ordered by
 * what lapses soonest and every row carries the same status chip the compliance
 * calendar uses — because a COI expiry *is* a compliance obligation, on the
 * same calendar, generated when the certificate is recorded.
 */
export default async function InsurancePage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const certificates = await listCertificates(ctx);
  const expired = certificates.filter((c) => toPlainDate(c.expiresOn) < now).length;
  const unnamed = certificates.filter((c) => !c.additionalInsuredVerified).length;

  return (
    <>
      <PageHeader
        eyebrow="Insurance"
        title={
          expired === 0
            ? "Nothing has lapsed"
            : expired === 1
              ? "1 certificate has lapsed"
              : `${expired} certificates have lapsed`
        }
        lede={
          unnamed > 0
            ? `${unnamed} ${unnamed === 1 ? "certificate does" : "certificates do"} not name the corporation as an additional insured. Those are valid on their face and do nothing for the building.`
            : "Every certificate on file names the corporation as an additional insured."
        }
        actions={
          can(ctx, "coi.manage") ? (
            <CertificateForm buildingSlug={buildingSlug} />
          ) : undefined
        }
      />

      {certificates.length === 0 ? (
        <EmptyState title="No certificates on file">
          Certificates are recorded against a contractor, a mover or a shareholder.
          Their expiry goes on the compliance calendar automatically, with reminders
          before it lapses.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Certificates of insurance</caption>
            <thead>
              <tr className="border-limestone-deep border-b">
                <th scope="col" className="eyebrow pr-4 pb-2 font-normal">
                  Insured
                </th>
                <th
                  scope="col"
                  className="eyebrow hidden pr-4 pb-2 font-normal md:table-cell"
                >
                  Policy
                </th>
                <th
                  scope="col"
                  className="eyebrow hidden pr-4 pb-2 text-right font-normal sm:table-cell"
                >
                  Coverage
                </th>
                <th scope="col" className="eyebrow pr-4 pb-2 text-right font-normal">
                  Expires
                </th>
                <th scope="col" className="eyebrow pb-2 text-right font-normal">
                  Status
                </th>
              </tr>
            </thead>
            <tbody>
              {certificates.map((certificate) => {
                const expiresOn = toPlainDate(certificate.expiresOn);
                const status = dueStatus({ state: "OPEN", dueOn: expiresOn }, now);

                return (
                  <tr key={certificate.id} className="ledger-row align-baseline">
                    <td className="py-3 pr-4">
                      <span className="text-ironwork block text-sm font-medium">
                        {certificate.holderName}
                      </span>
                      <span className="text-ironwork-faint mt-0.5 flex flex-wrap gap-x-2 font-mono text-[0.6875rem]">
                        <span>{certificate.holderKind.toLowerCase()}</span>
                        {certificate.unit ? (
                          <span>{certificate.unit.label}</span>
                        ) : null}
                        {certificate.additionalInsuredVerified ? null : (
                          <span className="text-stamp">corporation not named</span>
                        )}
                      </span>
                    </td>
                    <td className="text-ironwork-soft hidden py-3 pr-4 font-mono text-xs md:table-cell">
                      {certificate.carrier}
                      <span className="text-ironwork-faint block">
                        {certificate.policyNumber}
                      </span>
                    </td>
                    <td className="text-ironwork hidden py-3 pr-4 text-right font-mono text-xs whitespace-nowrap sm:table-cell">
                      {certificate.coverageCents
                        ? formatMoney(money(certificate.coverageCents))
                        : "—"}
                    </td>
                    <td className="text-ironwork py-3 pr-4 text-right font-mono text-xs whitespace-nowrap">
                      {formatDate(expiresOn)}
                      <span className="text-ironwork-faint block">
                        {relativeDays(now, expiresOn)}
                      </span>
                    </td>
                    <td className="py-3 text-right">
                      <StatusChip status={status} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-ironwork-faint mt-6 text-xs">
        Every expiry here also appears on the{" "}
        <Link
          href={`/b/${buildingSlug}/compliance`}
          className="text-verdigris underline underline-offset-4"
        >
          compliance calendar
        </Link>
        , with reminders 45, 14 and 3 days before.
      </p>
    </>
  );
}
