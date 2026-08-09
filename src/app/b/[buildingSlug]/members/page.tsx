import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { primaryRole, roleLabel } from "~/lib/auth/roles";
import { listInvitations, listMembers, listUnits } from "~/lib/db/scoped/units";
import { formatDate, relativeDays, today, toPlainDateIn } from "~/lib/time";
import { InviteForm } from "./InviteForm";
import { RevokeButton } from "./RevokeButton";

/**
 * Who is in the building.
 *
 * Two lists, and the second one is the point: outstanding invitations are the
 * building's open doors, and a board that cannot see them cannot close them. An
 * invitation sent to a mistyped address sits there for fourteen days looking
 * like nothing at all unless it is on a page somebody reads.
 */
export default async function MembersPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);
  const now = today(ctx.building.timezone);

  const mayInvite = can(ctx, "member.invite");

  const [members, units, invitations] = await Promise.all([
    listMembers(ctx),
    listUnits(ctx),
    mayInvite ? listInvitations(ctx) : Promise.resolve([]),
  ]);

  const unitLabel = new Map(units.map((unit) => [unit.id, unit.label]));

  // Expiry is compared as a calendar day in the building's timezone, so an
  // invitation that runs out this evening still shows today rather than
  // vanishing at 8pm when UTC rolls over.
  const outstanding = invitations
    .map((invitation) => ({
      ...invitation,
      expiresOn: toPlainDateIn(invitation.expiresAt, ctx.building.timezone),
    }))
    .filter(
      (invitation) =>
        !invitation.acceptedAt &&
        !invitation.revokedAt &&
        invitation.expiresOn >= now,
    );

  return (
    <>
      <PageHeader
        eyebrow="Members"
        title={
          members.length === 1
            ? "1 person has access"
            : `${members.length} people have access`
        }
        lede={
          mayInvite
            ? "Everyone here can see the building's records. What they can change depends on their role, and only a shareholder's own arrears and alteration requests are private to them."
            : "Everyone here can see the building's records. What they can change depends on their role."
        }
      />

      {mayInvite ? (
        <div className="mb-8">
          <InviteForm
            buildingSlug={buildingSlug}
            units={units.map((unit) => ({ id: unit.id, label: unit.label }))}
            canAssignOfficerRoles={can(ctx, "member.manage")}
          />
        </div>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Members of {ctx.building.name}</caption>
          <thead>
            <tr className="border-b border-limestone-deep">
              <th scope="col" className="eyebrow pb-2 pr-4 font-normal">
                Name
              </th>
              <th scope="col" className="eyebrow hidden pb-2 pr-4 font-normal sm:table-cell">
                Role
              </th>
              <th scope="col" className="eyebrow pb-2 text-right font-normal">
                Apartment
              </th>
            </tr>
          </thead>
          <tbody>
            {members.map((member) => (
              <tr key={member.id} className="ledger-row align-baseline">
                <td className="py-3 pr-4">
                  <span className="block text-sm font-medium text-ironwork">
                    {member.user.name ?? member.user.email}
                    {member.user.id === ctx.user.id ? (
                      <span className="ml-2 font-mono text-[0.6875rem] font-normal text-ironwork-faint">
                        you
                      </span>
                    ) : null}
                  </span>
                  <span className="mt-0.5 block font-mono text-[0.6875rem] text-ironwork-faint">
                    {member.user.email}
                  </span>
                  <span className="mt-0.5 block font-mono text-[0.6875rem] text-ironwork-soft sm:hidden">
                    {member.title ?? primaryRole(member.roles)}
                  </span>
                </td>
                <td className="hidden py-3 pr-4 align-top text-sm text-ironwork-soft sm:table-cell">
                  {member.title ?? primaryRole(member.roles)}
                  {member.roles.length > 1 ? (
                    <span className="mt-0.5 block font-mono text-[0.6875rem] text-ironwork-faint">
                      {member.roles.map(roleLabel).join(" · ")}
                    </span>
                  ) : null}
                </td>
                <td className="py-3 text-right align-top font-mono text-xs whitespace-nowrap text-ironwork">
                  {member.units.length === 0
                    ? "—"
                    : member.units
                        .map((link) => unitLabel.get(link.unitId) ?? "—")
                        .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {mayInvite ? (
        <section className="mt-10">
          <h2 className="eyebrow mb-3 border-b border-limestone pb-2">
            Invitations outstanding
          </h2>

          {outstanding.length === 0 ? (
            <EmptyState title="No invitations are open">
              Nobody outside the list above can get in. An invitation link works
              for fourteen days and only for the address it was sent to.
            </EmptyState>
          ) : (
            <ul className="divide-y divide-limestone">
              {outstanding.map((invitation) => (
                <li
                  key={invitation.id}
                  className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3"
                >
                  <div className="min-w-0">
                    <span className="block font-mono text-sm break-all text-ironwork">
                      {invitation.email}
                    </span>
                    <span className="mt-0.5 block text-xs text-ironwork-faint">
                      {primaryRole(invitation.roles)}
                      {invitation.unitIds.length > 0
                        ? ` · ${invitation.unitIds
                            .map((unitId) => unitLabel.get(unitId) ?? "—")
                            .join(", ")}`
                        : ""}
                      {" · expires "}
                      {formatDate(invitation.expiresOn)}
                      {" ("}
                      {relativeDays(now, invitation.expiresOn)}
                      {")"}
                    </span>
                  </div>
                  <RevokeButton
                    buildingSlug={buildingSlug}
                    invitationId={invitation.id}
                    email={invitation.email}
                  />
                </li>
              ))}
            </ul>
          )}

          <p className="mt-4 text-xs leading-relaxed text-ironwork-faint">
            Withdrawing an invitation kills the link immediately, even if it has
            already been opened. Links that expire or are used stop working on
            their own; they are not listed here.
          </p>
        </section>
      ) : null}
    </>
  );
}
