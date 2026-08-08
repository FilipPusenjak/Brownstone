import type { EntityType } from "~/generated/prisma/enums";
import { assertCan } from "~/lib/auth/capabilities";
import type { BuildingContext } from "../context";
import type { ScopedTx } from "../tx";
import { withBuildingTx } from "../tx";

/**
 * The audit log.
 *
 * Board turnover is the reason this product exists. Three years from now the
 * question will be "who decided we didn't need the gas inspection, and when",
 * and the only acceptable answer is a row with a name and a date on it.
 *
 * Writes take a transaction rather than opening their own, so the record and
 * the thing it records commit together or not at all. An audit log that can
 * disagree with the data is worse than none.
 */

export interface AuditEntry {
  readonly action: string;
  readonly entityType: EntityType;
  readonly entityId: string;
  readonly before?: unknown;
  readonly after?: unknown;
  /** One line, in the words a board member would use. */
  readonly summary?: string;
}

export async function recordAudit(
  tx: ScopedTx,
  ctx: BuildingContext,
  entry: AuditEntry,
): Promise<void> {
  await tx.auditLog.create({
    data: {
      buildingId: ctx.building.id,
      actorUserId: ctx.user.id,
      actorMembershipId: ctx.membership.id,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId,
      before: entry.before === undefined ? undefined : JSON.parse(JSON.stringify(entry.before)),
      after: entry.after === undefined ? undefined : JSON.parse(JSON.stringify(entry.after)),
      summary: entry.summary ?? null,
    },
  });
}

export async function listAudit(
  ctx: BuildingContext,
  options: { limit?: number; entityType?: EntityType; entityId?: string } = {},
) {
  assertCan(ctx, "audit.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.auditLog.findMany({
      where: {
        ...(options.entityType ? { entityType: options.entityType } : {}),
        ...(options.entityId ? { entityId: options.entityId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: options.limit ?? 100,
      include: {
        actorMembership: {
          select: { id: true, title: true, user: { select: { name: true, email: true } } },
        },
      },
    }),
  );
}

/** Unfiltered read used by the tenancy suite. Not capability-gated by design. */
export async function listAuditForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.auditLog.findMany({ select: { id: true, buildingId: true } }),
  );
}
