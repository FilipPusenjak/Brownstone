import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { ScaffoldNotice } from "~/components/patterns/ScaffoldNotice";
import { getBuildingContext } from "~/lib/auth/current";
import { listTickets } from "~/lib/db/scoped/modules";
import { formatDate, toPlainDate } from "~/lib/time";

export const MISSING = [
  "Reporting a ticket, with photos",
  "Triage: assigning to the super or a vendor",
  "The responsibility determination, through the approval workflow",
  "Resolution and the record of what was done",
];

/**
 * Repair tickets — scaffold.
 *
 * The responsibility column is the interesting one and the reason this module
 * exists. Every repair in a co-op turns into the same argument — is this the
 * shareholder's or the corporation's? — and the answer needs to be a written
 * determination with an officer's name on it rather than a conversation nobody
 * can reconstruct two boards later. It will run through the same approval
 * workflow as alterations.
 */
export default async function TicketsPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const tickets = await listTickets(ctx);

  const undetermined = tickets.filter(
    (t) => t.responsibility === "UNDETERMINED" && t.status !== "CLOSED",
  ).length;

  return (
    <>
      <PageHeader
        eyebrow="Repairs"
        title={
          undetermined === 0
            ? "Nothing waiting on a decision"
            : `${undetermined} ${undetermined === 1 ? "repair needs" : "repairs need"} a responsibility decision`
        }
        lede="Who pays is the question every repair turns into, so it's recorded rather than remembered."
      />

      <ScaffoldNotice missing={MISSING} />

      {tickets.length === 0 ? (
        <EmptyState title="No open repairs">
          Anything broken in the building — the front door, a radiator, the stoop — gets
          reported here.
        </EmptyState>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <caption className="sr-only">Repair tickets</caption>
            <thead>
              <tr className="border-limestone-deep border-b">
                <th scope="col" className="eyebrow pr-4 pb-2 font-normal">
                  What&rsquo;s wrong
                </th>
                <th scope="col" className="eyebrow pr-4 pb-2 font-normal">
                  Where
                </th>
                <th
                  scope="col"
                  className="eyebrow hidden pr-4 pb-2 text-right font-normal sm:table-cell"
                >
                  Reported
                </th>
                <th scope="col" className="eyebrow pb-2 text-right font-normal">
                  Who pays
                </th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((ticket) => (
                <tr key={ticket.id} className="ledger-row align-baseline">
                  <td className="py-3 pr-4">
                    <span className="text-ironwork block text-sm font-medium">
                      {ticket.title}
                    </span>
                    <span className="text-ironwork-faint font-mono text-[0.6875rem]">
                      {ticket.status.toLowerCase().replace("_", " ")}
                      {ticket.priority === "URGENT" ||
                      ticket.priority === "EMERGENCY" ? (
                        <span className="text-stamp">
                          {" · "}
                          {ticket.priority.toLowerCase()}
                        </span>
                      ) : null}
                    </span>
                  </td>
                  <td className="text-ironwork py-3 pr-4 font-mono text-xs">
                    {ticket.unit?.label ?? ticket.area ?? "Common"}
                  </td>
                  <td className="text-ironwork-soft hidden py-3 pr-4 text-right font-mono text-xs whitespace-nowrap sm:table-cell">
                    {formatDate(toPlainDate(ticket.createdAt))}
                  </td>
                  <td className="py-3 text-right">
                    <ResponsibilityChip value={ticket.responsibility} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

function ResponsibilityChip({ value }: { value: string }) {
  const styles: Record<string, { label: string; className: string }> = {
    UNDETERMINED: {
      label: "Not decided",
      className: "border-started-line bg-started-soft text-started",
    },
    SHAREHOLDER: {
      label: "Shareholder",
      className: "border-limestone-deep text-ironwork",
    },
    COOPERATIVE: {
      label: "The co-op",
      className: "border-limestone-deep text-ironwork",
    },
    SHARED: { label: "Shared", className: "border-limestone-deep text-ironwork" },
  };
  const style = styles[value] ?? styles["UNDETERMINED"];

  return (
    <span
      className={`rounded-chip inline-flex shrink-0 items-center border px-1.5 py-0.5 font-mono text-[0.6875rem] tracking-wider uppercase ${style?.className ?? ""}`}
    >
      {style?.label}
    </span>
  );
}
