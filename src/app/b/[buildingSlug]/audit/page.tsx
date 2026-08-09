import { notFound } from "next/navigation";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { CapabilityError } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { listAudit } from "~/lib/db/scoped/audit";
import { formatInstant } from "~/lib/time";

/**
 * The audit trail.
 *
 * Append-only, and not by convention: the runtime database role is never
 * granted UPDATE or DELETE on this table, so an entry cannot be edited by the
 * application at all — not by a Server Action, not by a developer at 11pm.
 *
 * It reads as a ledger rather than a log. A board looks at this to answer "who
 * took that off the calendar, and when", so the summary is the sentence a
 * person would say, and the dotted action name — the same string as the
 * capability that authorised it — sits underneath in mono for anyone who needs
 * to be precise.
 */

const ENTITY_LABELS: Record<string, string> = {
  OBLIGATION: "Obligation",
  ALTERATION_REQUEST: "Alteration",
  CERTIFICATE_OF_INSURANCE: "Certificate",
  DOCUMENT: "Document",
  MEMBERSHIP: "Membership",
  INVITATION: "Invitation",
  UNIT: "Apartment",
  BUILDING: "Building",
};

export default async function AuditPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  // A 404 rather than a 403, for the same reason the building itself is: the
  // absence of a page tells a reader nothing about what it would have held.
  let entries: Awaited<ReturnType<typeof listAudit>>;
  try {
    entries = await listAudit(ctx, { limit: 200 });
  } catch (error) {
    if (error instanceof CapabilityError) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        eyebrow="Audit trail"
        title="What has been done, and by whom"
        lede="Every decision that changes the building's record writes a line here. Entries cannot be edited or removed — the application's database role has no permission to do either."
      />

      {entries.length === 0 ? (
        <EmptyState title="Nothing recorded yet">
          Filing an obligation, deciding an alteration, inviting a neighbour —
          each of those writes a line here as it happens.
        </EmptyState>
      ) : (
        <ol className="divide-y divide-limestone">
          {entries.map((entry) => (
            <li key={entry.id} className="py-3 sm:flex sm:items-baseline sm:gap-x-4">
              <span className="block font-mono text-[0.6875rem] whitespace-nowrap text-ironwork-faint sm:w-40 sm:shrink-0">
                {formatInstant(entry.createdAt, ctx.building.timezone)}
              </span>
              <span className="mt-1 block min-w-0 flex-1 sm:mt-0">
                <span className="block text-sm text-ironwork">
                  {entry.summary ?? `${entry.action} on ${entry.entityType}`}
                </span>
                <span className="mt-0.5 flex flex-wrap gap-x-2 font-mono text-[0.6875rem] text-ironwork-faint">
                  <span>{entry.action}</span>
                  <span>{ENTITY_LABELS[entry.entityType] ?? entry.entityType}</span>
                </span>
              </span>
              <span className="mt-1 block text-xs whitespace-nowrap text-ironwork-soft sm:mt-0 sm:text-right">
                {entry.actorMembership?.user.name ??
                  entry.actorMembership?.user.email ??
                  "the system"}
              </span>
            </li>
          ))}
        </ol>
      )}

      <p className="mt-6 max-w-2xl text-xs leading-relaxed text-ironwork-faint">
        The most recent {entries.length} entries. Anything the daily reminder run
        does is recorded as the system rather than a person, because nobody
        pressed anything.
      </p>
    </>
  );
}
