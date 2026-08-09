import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { getBuildingContext } from "~/lib/auth/current";
import { listDocuments } from "~/lib/db/scoped/documents";
import { formatDate, today, toPlainDate } from "~/lib/time";

/**
 * Everything on file.
 *
 * There is no shareable document URL anywhere in this product. Each row links
 * to a route handler that re-checks the member's capability and then issues a
 * presigned GET good for a few minutes, so a link a departed board member kept
 * in their inbox stops working the day their membership ends.
 *
 * The list itself is unit-scoped through whatever each document is attached to:
 * a shareholder who may not see 4F's alteration request does not see its plans
 * here either. Unattached documents — the proprietary lease, the house rules —
 * are the building's reference shelf and stay visible to everyone.
 */

const TYPE_LABELS: Record<string, string> = {
  CERTIFICATE_OF_INSURANCE: "Certificate of insurance",
  INSPECTION_REPORT: "Inspection report",
  FILING_RECEIPT: "Filing receipt",
  NOTICE_PROOF: "Proof of notice",
  ALTERATION_PLAN: "Alteration plan",
  TICKET_PHOTO: "Repair photo",
  MEETING_MINUTES: "Minutes",
  PROPRIETARY_LEASE: "Proprietary lease",
  HOUSE_RULES: "House rules",
  OTHER: "Other",
};

function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DocumentsPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const documents = await listDocuments(ctx);

  return (
    <>
      <PageHeader
        eyebrow="Documents"
        title={
          documents.length === 1
            ? "1 document on file"
            : `${documents.length} documents on file`
        }
        lede="Documents are uploaded against the record they belong to — an alteration request, a certificate, a filing. Downloads are issued one at a time and expire; there is no permanent link to hand around."
      />

      {documents.length === 0 ? (
        <EmptyState title="Nothing on file yet">
          Files arrive here by being attached to something: plans on an alteration
          request, a certificate of insurance, a receipt on a filing.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">
              Documents held for {ctx.building.name}
            </caption>
            <thead>
              <tr className="border-limestone-deep border-b">
                <th scope="col" className="eyebrow pr-4 pb-2 font-normal">
                  Document
                </th>
                <th
                  scope="col"
                  className="eyebrow hidden pr-4 pb-2 font-normal md:table-cell"
                >
                  Added by
                </th>
                <th
                  scope="col"
                  className="eyebrow hidden pr-4 pb-2 text-right font-normal sm:table-cell"
                >
                  Size
                </th>
                <th scope="col" className="eyebrow pb-2 text-right font-normal">
                  Added
                </th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => {
                const expiresOn = document.expiresOn
                  ? toPlainDate(document.expiresOn)
                  : null;

                return (
                  <tr key={document.id} className="ledger-row align-baseline">
                    <td className="py-3 pr-4">
                      <a
                        href={`/api/files/${document.id}?building=${buildingSlug}`}
                        className="text-ironwork decoration-limestone-deep hover:decoration-verdigris text-sm font-medium underline underline-offset-4"
                      >
                        {document.title}
                      </a>
                      <span className="text-ironwork-faint mt-0.5 flex flex-wrap gap-x-2 font-mono text-[0.6875rem]">
                        <span>{TYPE_LABELS[document.type] ?? document.type}</span>
                        {expiresOn ? (
                          <span className={expiresOn < now ? "text-stamp" : undefined}>
                            {expiresOn < now ? "expired" : "expires"}{" "}
                            {formatDate(expiresOn)}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <td className="text-ironwork-soft hidden py-3 pr-4 align-top text-sm md:table-cell">
                      {document.uploadedBy?.user.name ??
                        document.uploadedBy?.user.email ??
                        "—"}
                    </td>
                    <td className="text-ironwork-soft hidden py-3 pr-4 text-right align-top font-mono text-xs whitespace-nowrap sm:table-cell">
                      {sizeOf(document.sizeBytes)}
                    </td>
                    <td className="text-ironwork py-3 text-right align-top font-mono text-xs whitespace-nowrap">
                      {formatDate(toPlainDate(document.createdAt))}
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
