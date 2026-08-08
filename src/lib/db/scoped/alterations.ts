import { assertCan } from "~/lib/auth/capabilities";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { unitFilter, visibility } from "../visibility";

/**
 * Alteration requests, and the approval workflow underneath them.
 *
 * Unit-scoped: a shareholder sees their own renovation requests, officers with
 * `alteration.viewAll` see every one. Board-only comments are filtered here
 * rather than in the view, because a comment thread that leaks through an API
 * response leaks whether or not a component renders it.
 */

export async function listAlterations(
  ctx: BuildingContext,
  options: { status?: string } = {},
) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.alterationRequest.findMany({
      where: {
        ...unitFilter(ctx, "alteration"),
        ...(options.status ? { approval: { status: options.status as never } } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        buildingId: true,
        unitId: true,
        title: true,
        scope: true,
        contractorName: true,
        wetOverDry: true,
        affectsStructure: true,
        affectsRiser: true,
        requiresDobPermit: true,
        dobJobNumber: true,
        plannedStart: true,
        plannedEnd: true,
        completedOn: true,
        createdAt: true,
        unit: { select: { id: true, label: true, floorIndex: true } },
        approval: {
          select: {
            id: true,
            status: true,
            submittedAt: true,
            decidedAt: true,
            decisionNote: true,
            conditions: true,
            submittedBy: {
              select: { id: true, user: { select: { name: true, email: true } } },
            },
            decidedBy: {
              select: { id: true, user: { select: { name: true, email: true } } },
            },
          },
        },
        certificates: {
          select: {
            id: true,
            holderName: true,
            holderKind: true,
            expiresOn: true,
            additionalInsuredVerified: true,
          },
        },
      },
    }),
  );
}

export async function getAlteration(ctx: BuildingContext, alterationId: string) {
  const view = visibility(ctx, "alteration");
  const canSeeInternal = ctx.capabilities.has("alteration.commentInternal");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const alteration = await tx.alterationRequest.findUnique({
      where: { id: alterationId },
      include: {
        unit: { select: { id: true, label: true, floorIndex: true } },
        certificates: true,
        approval: {
          include: {
            submittedBy: {
              select: { id: true, user: { select: { name: true, email: true } } },
            },
            assignee: {
              select: { id: true, user: { select: { name: true, email: true } } },
            },
            decidedBy: {
              select: { id: true, user: { select: { name: true, email: true } } },
            },
            comments: {
              where: canSeeInternal ? {} : { visibility: "SHARED" },
              orderBy: { createdAt: "asc" },
              include: {
                author: {
                  select: { id: true, user: { select: { name: true, email: true } } },
                },
              },
            },
          },
        },
      },
    });

    if (!alteration) return null;
    if (view.scope === "all") return alteration;
    if (view.scope === "none") return null;
    return view.unitIds.includes(alteration.unitId) ? alteration : null;
  });
}

export async function listApprovalRequests(
  ctx: BuildingContext,
  options: { kind?: "ALTERATION" | "SUBLET" | "TICKET_RESPONSIBILITY" } = {},
) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.approvalRequest.findMany({
      where: options.kind ? { kind: options.kind } : {},
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        buildingId: true,
        kind: true,
        status: true,
        submittedAt: true,
        decidedAt: true,
      },
    }),
  );
}

export async function listApprovalComments(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.approvalComment.findMany({
      where: ctx.capabilities.has("alteration.commentInternal")
        ? {}
        : { visibility: "SHARED" },
      select: {
        id: true,
        buildingId: true,
        requestId: true,
        body: true,
        visibility: true,
      },
    }),
  );
}

/** Alterations awaiting a decision, for the board's queue. */
export async function listPendingAlterations(ctx: BuildingContext) {
  assertCan(ctx, "alteration.viewAll");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.alterationRequest.findMany({
      where: { approval: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } } },
      orderBy: { createdAt: "asc" },
      include: {
        unit: { select: { id: true, label: true } },
        approval: { select: { id: true, status: true, submittedAt: true } },
      },
    }),
  );
}

/** Unfiltered reads used by the tenancy suite. */
export async function listAlterationsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.alterationRequest.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listApprovalRequestsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.approvalRequest.findMany({ select: { id: true, buildingId: true } }),
  );
}
