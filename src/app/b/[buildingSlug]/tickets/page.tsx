import Link from "next/link";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { listTickets } from "~/lib/db/scoped/tickets";
import { listUnits } from "~/lib/db/scoped/units";
import { formatDate, toPlainDate } from "~/lib/time";
import { ResponsibilityChip } from "./ResponsibilityChip";
import { ReportTicket } from "./TicketForms";

/**
 * Repair tickets.
 *
 * The heading counts what is waiting on a decision rather than what is open,
 * because an undetermined repair is the one that stalls: nobody wants to pay
 * for it, so nobody arranges it. Open work sorts to the top and, within that,
 * the loudest first — an emergency below the fold is an emergency nobody sees.
 */
export default async function TicketsPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const [tickets, allUnits] = await Promise.all([listTickets(ctx), listUnits(ctx)]);

  const undetermined = tickets.filter(
    (t) => t.responsibility === "UNDETERMINED" && t.status !== "CLOSED",
  ).length;

  // A shareholder may report for their own apartment or somewhere shared;
  // officers who already see every unit may file on a neighbour's behalf.
  const mayFileForOthers = can(ctx, "ticket.viewAll");
  const units = mayFileForOthers
    ? allUnits
    : allUnits.filter((unit) => ctx.unitIds.includes(unit.id));

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
        actions={
          <ReportTicket
            buildingSlug={buildingSlug}
            units={units.map((unit) => ({ id: unit.id, label: unit.label }))}
            canReportForOthers={mayFileForOthers}
          />
        }
      />

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
                    <Link
                      href={`/b/${buildingSlug}/tickets/${ticket.id}`}
                      className="text-ironwork hover:text-verdigris block text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {ticket.title}
                    </Link>
                    <span className="text-ironwork-faint font-mono text-[0.6875rem]">
                      {ticket.status.toLowerCase().replace("_", " ")}
                      {ticket.priority === "URGENT" ||
                      ticket.priority === "EMERGENCY" ? (
                        <span className="text-stamp">
                          {" · "}
                          {ticket.priority.toLowerCase()}
                        </span>
                      ) : null}
                      {ticket.assignee || ticket.vendorName ? (
                        <>
                          {" · "}
                          {ticket.vendorName ??
                            ticket.assignee?.user.name ??
                            ticket.assignee?.user.email}
                        </>
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
