import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Role } from "~/generated/prisma/enums";
import { withBuildingTx, withInvitationTokenTx, withUntenantedTx } from "~/lib/db/tx";
import { fail, ok, type Result } from "~/lib/result";
import { toDbDate, today } from "~/lib/time";

/**
 * Invitations.
 *
 * This is the highest-risk surface in the product: a working invitation link is
 * a key to a building's entire record. The rules below are each here because
 * the alternative is a way in.
 *
 * **The token is never stored.** Only its SHA-256 hash. A database dump, a
 * leaked backup or a compromised read replica hands over hashes, not building
 * access.
 *
 * **It is bound to the invited address.** Accepting requires being signed in as
 * the person who was invited. Email gets forwarded — "here's the co-op thing,
 * can you take a look?" — and without this binding, a forwarded link grants a
 * stranger a membership. The friction of asking someone to sign in with the
 * address they were invited at is small; the failure it prevents is not.
 *
 * **It expires, and it is single-use.** Fourteen days, and `acceptedAt` closes
 * it. An invitation sitting in an inbox for two years is a key sitting under a
 * doormat for two years.
 *
 * **It can be revoked.** A board that invites the wrong address needs to undo
 * it before the wrong person notices.
 */

const TOKEN_BYTES = 32;
export const INVITATION_TTL_DAYS = 14;

/** The raw token, and the hash to store. The raw form exists only in the email. */
export function mintToken(): { token: string; tokenHash: string } {
  const token = randomBytes(TOKEN_BYTES).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Compares two hashes in constant time.
 *
 * The lookup is by hash, so this is belt and braces rather than the primary
 * defence — but a hash comparison that short-circuits is a habit worth not
 * having anywhere near an auth path.
 */
export function hashesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface InvitationSummary {
  readonly id: string;
  readonly email: string;
  readonly roles: Role[];
  readonly buildingName: string;
  readonly buildingSlug: string;
  readonly invitedBy: string;
  readonly expiresAt: Date;
}

export type InvitationLookup =
  | { readonly ok: true; readonly invitation: InvitationSummary }
  | { readonly ok: false; readonly reason: string };

/**
 * Finds an invitation by its raw token.
 *
 * Two reads, in this order. The first runs in a scope one row wide — the
 * database will only return the invitation whose hash the caller can already
 * present — because someone following an invitation link has, by definition, no
 * membership in the building yet, so there is no tenant to resolve. Only once
 * that row names its building does the second read open that tenant, for the
 * building's name and the inviter's. Holding a valid token is what authorises
 * learning those two things and nothing else.
 */
export async function lookupInvitation(token: string): Promise<InvitationLookup> {
  if (!token || token.length < 20) {
    return { ok: false, reason: "That invitation link isn't valid." };
  }

  const tokenHash = hashToken(token);

  const invitation = await withInvitationTokenTx(tokenHash, (tx) =>
    tx.invitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        buildingId: true,
        email: true,
        roles: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
        tokenHash: true,
        invitedByMembershipId: true,
      },
    }),
  );

  // One message for "no such token" and for a hash mismatch, so a caller cannot
  // learn which invitations exist by probing.
  if (!invitation || !hashesMatch(invitation.tokenHash, tokenHash)) {
    return { ok: false, reason: "That invitation link isn't valid." };
  }

  if (invitation.revokedAt) {
    return {
      ok: false,
      reason: "That invitation was withdrawn. Ask the board for a new one.",
    };
  }
  if (invitation.acceptedAt) {
    return {
      ok: false,
      reason: "That invitation has already been used. Sign in instead.",
    };
  }
  if (invitation.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      reason: "That invitation has expired. Ask the board for a new one.",
    };
  }

  const context = await withBuildingTx(invitation.buildingId, async (tx) => {
    const building = await tx.building.findUnique({
      where: { id: invitation.buildingId },
      select: { name: true, slug: true },
    });
    const inviter = await tx.membership.findUnique({
      where: { id: invitation.invitedByMembershipId },
      select: { user: { select: { name: true, email: true } } },
    });
    return { building, inviter };
  });

  // The building was deleted out from under the invitation. Nothing to join.
  if (!context.building) {
    return { ok: false, reason: "That invitation link isn't valid." };
  }

  return {
    ok: true,
    invitation: {
      id: invitation.id,
      email: invitation.email,
      roles: invitation.roles,
      buildingName: context.building.name,
      buildingSlug: context.building.slug,
      invitedBy:
        context.inviter?.user.name ?? context.inviter?.user.email ?? "the board",
      expiresAt: invitation.expiresAt,
    },
  };
}

export interface AcceptedInvitation {
  readonly buildingSlug: string;
  readonly buildingName: string;
  readonly membershipId: string;
}

/**
 * Redeems an invitation for a signed-in user.
 *
 * Every check is re-run here rather than trusted from the lookup that rendered
 * the page. The page may have been open for an hour, the invitation may have
 * been revoked since, and a caller can post to this without ever loading it.
 */
export async function acceptInvitation(
  token: string,
  user: { id: string; email: string },
): Promise<Result<AcceptedInvitation>> {
  const lookup = await lookupInvitation(token);
  if (!lookup.ok) return fail("invalid", lookup.reason);

  const invitation = lookup.invitation;

  // The binding. Case-insensitive, because nobody types their address the same
  // way twice, but otherwise exact.
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    return fail(
      "forbidden",
      `This invitation was sent to ${invitation.email}. You're signed in as ${user.email}. Sign in with the invited address, or ask the board to invite this one.`,
    );
  }

  const tokenHash = hashToken(token);

  const row = await withInvitationTokenTx(tokenHash, (tx) =>
    tx.invitation.findUnique({
      where: { tokenHash },
      select: { id: true, buildingId: true, roles: true, unitIds: true },
    }),
  );
  if (!row) return fail("invalid", "That invitation link isn't valid.");

  return withBuildingTx(row.buildingId, async (tx) => {
    // Re-read inside the transaction and refuse if it closed in the meantime.
    // Two clicks on the same link half a second apart would otherwise produce
    // two memberships, or a crash.
    const claimed = await tx.invitation.updateMany({
      where: { id: row.id, acceptedAt: null, revokedAt: null },
      data: { acceptedAt: new Date(), acceptedByUserId: user.id },
    });
    if (claimed.count === 0) {
      return fail(
        "conflict",
        "That invitation has already been used. Sign in instead.",
      );
    }

    const existing = await tx.membership.findUnique({
      where: { userId_buildingId: { userId: user.id, buildingId: row.buildingId } },
      select: { id: true, status: true },
    });

    // Already a member — a re-invited former neighbour, or a second invitation
    // for the same person. Reactivate rather than failing: the invitation is
    // spent either way, and the intent was plainly to give them access.
    const membership = existing
      ? await tx.membership.update({
          where: { id: existing.id },
          data: { status: "ACTIVE", roles: row.roles, endedOn: null },
          select: { id: true },
        })
      : await tx.membership.create({
          data: {
            buildingId: row.buildingId,
            userId: user.id,
            roles: row.roles,
            status: "ACTIVE",
            joinedOn: toDbDate(today()),
          },
          select: { id: true },
        });

    for (const unitId of row.unitIds) {
      const unit = await tx.unit.findUnique({
        where: { id: unitId },
        select: { id: true },
      });
      // RLS confines this to the building, so a unit id from elsewhere simply
      // is not found and is skipped rather than linked.
      if (!unit) continue;

      await tx.membershipUnit.upsert({
        where: { membershipId_unitId: { membershipId: membership.id, unitId } },
        create: {
          buildingId: row.buildingId,
          membershipId: membership.id,
          unitId,
          relation: "OWNER",
        },
        update: {},
      });
    }

    await tx.auditLog.create({
      data: {
        buildingId: row.buildingId,
        actorUserId: user.id,
        actorMembershipId: membership.id,
        action: "member.acceptInvitation",
        entityType: "MEMBERSHIP",
        entityId: membership.id,
        after: { email: user.email, roles: row.roles },
        summary: `${user.email} joined the building`,
      },
    });

    const building = await tx.building.findUnique({
      where: { id: row.buildingId },
      select: { slug: true, name: true },
    });

    return ok({
      buildingSlug: building?.slug ?? "",
      buildingName: building?.name ?? "",
      membershipId: membership.id,
    });
  });
}

/** Finds a user by email, for the accept path. Identity is not tenant data. */
export async function userByEmail(email: string) {
  return withUntenantedTx((tx) =>
    tx.user.findUnique({
      where: { email: email.toLowerCase() },
      select: { id: true, email: true },
    }),
  );
}
