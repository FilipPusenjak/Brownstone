import { render } from "@react-email/render";
import type { Role } from "~/generated/prisma/enums";
import { assertCan } from "~/lib/auth/capabilities";
import { INVITATION_TTL_DAYS, mintToken } from "~/lib/auth/invitations";
import {
  InvitationEmail,
  invitationText,
  invitationSubject,
  type InvitationProps,
} from "~/lib/email/templates/invitation";
import { sendNotice } from "~/lib/email/send";
import { env } from "~/lib/env";
import { fail, ok, type Result } from "~/lib/result";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { recordAudit } from "./audit";

/**
 * Inviting someone into a building.
 *
 * The raw token exists in exactly two places: the email, and this function's
 * local scope. It is hashed before it touches the database and never logged.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function inviteMember(
  ctx: BuildingContext,
  input: { email: string; roles: Role[]; unitIds?: string[]; note?: string | null },
): Promise<Result<{ invitationId: string; url: string }>> {
  assertCan(ctx, "member.invite");

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    return fail("invalid", "That doesn't look like an email address.", {
      email: "Check for a typo — the invitation goes to this address and nowhere else.",
    });
  }

  if (input.roles.length === 0) {
    return fail("invalid", "Pick at least one role.", {
      roles: "Most people are a shareholder. Officers get a second role as well.",
    });
  }

  // Only a member who can manage members may hand out officer roles. Otherwise
  // "invite" quietly becomes "promote", and a secretary could mint a president.
  const officerRoles: Role[] = ["PRESIDENT", "TREASURER", "SECRETARY", "BOARD_MEMBER"];
  if (input.roles.some((role) => officerRoles.includes(role))) {
    assertCan(ctx, "member.manage");
  }

  const { token, tokenHash } = mintToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_DAYS * 86_400_000);

  const created = await withBuildingTx(ctx.building.id, async (tx) => {
    const already = await tx.membership.findFirst({
      where: { user: { email }, status: "ACTIVE" },
      select: { id: true },
    });
    if (already) {
      return fail("conflict", `${email} is already a member of this building.`);
    }

    // Supersede any outstanding invitation to the same address rather than
    // leaving two live links to the same building.
    await tx.invitation.updateMany({
      where: { email, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    const validUnitIds: string[] = [];
    for (const unitId of input.unitIds ?? []) {
      const unit = await tx.unit.findUnique({
        where: { id: unitId },
        select: { id: true },
      });
      if (unit) validUnitIds.push(unit.id);
    }

    const invitation = await tx.invitation.create({
      data: {
        buildingId: ctx.building.id,
        email,
        roles: input.roles,
        unitIds: validUnitIds,
        tokenHash,
        expiresAt,
        invitedByMembershipId: ctx.membership.id,
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "member.invite",
      entityType: "INVITATION",
      entityId: invitation.id,
      after: { email, roles: input.roles },
      summary: `${email} invited to the building`,
    });

    return ok(invitation);
  });

  if (!created.ok) return created;

  const url = `${env().AUTH_URL}/invite/${token}`;

  const props: InvitationProps = {
    buildingName: ctx.building.name,
    invitedBy: ctx.user.name ?? ctx.user.email,
    roles: input.roles,
    note: input.note ?? null,
    url,
    expiresInDays: INVITATION_TTL_DAYS,
  };

  const outcome = await sendNotice({
    buildingId: ctx.building.id,
    to: email,
    template: "invitation",
    subject: invitationSubject(props),
    html: await render(InvitationEmail(props)),
    text: invitationText(props),
    payload: { roles: input.roles, invitationId: created.data.id },
    // Per invitation, not per address: re-inviting someone after a revoked
    // invitation must actually send.
    dedupeKey: `invitation:${created.data.id}`,
    subjectType: "INVITATION",
    subjectId: created.data.id,
  });

  if (outcome.status === "failed") {
    return fail(
      "unavailable",
      `The invitation was created but the email didn't go out: ${outcome.error}. The board can copy the link instead.`,
    );
  }

  // The URL is returned so an officer can pass it on by hand when someone's
  // mail is bouncing — a real situation in a building with one neighbour who
  // only uses a work address.
  return ok({ invitationId: created.data.id, url });
}

export async function revokeInvitation(
  ctx: BuildingContext,
  invitationId: string,
): Promise<Result<null>> {
  assertCan(ctx, "member.invite");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const invitation = await tx.invitation.findUnique({
      where: { id: invitationId },
      select: { id: true, email: true, acceptedAt: true },
    });
    if (!invitation) return fail("not_found", "That invitation could not be found.");
    if (invitation.acceptedAt) {
      return fail(
        "conflict",
        "That invitation was already used. Remove the membership instead.",
      );
    }

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date() },
    });

    await recordAudit(tx, ctx, {
      action: "member.revokeInvitation",
      entityType: "INVITATION",
      entityId: invitation.id,
      after: { email: invitation.email },
      summary: `Invitation to ${invitation.email} withdrawn`,
    });

    return ok(null);
  });
}
