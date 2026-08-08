import type { EntityType } from "~/generated/prisma/enums";
import { assertCan, can } from "~/lib/auth/capabilities";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { visibility } from "../visibility";

/**
 * Documents and certificates of insurance.
 *
 * Documents have no `unitId`, so unit scoping is applied through the entity a
 * document is linked to. Someone who may not see 4F's alteration request may
 * not see the plans attached to it either — the file is as sensitive as the
 * record it belongs to.
 */

export async function listDocuments(
  ctx: BuildingContext,
  options: { type?: string; includeDeleted?: boolean } = {},
) {
  const view = visibility(ctx, "document");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const documents = await tx.document.findMany({
      where: {
        ...(options.includeDeleted ? {} : { deletedAt: null }),
        ...(options.type ? { type: options.type as never } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        buildingId: true,
        type: true,
        title: true,
        contentType: true,
        sizeBytes: true,
        issuedOn: true,
        expiresOn: true,
        createdAt: true,
        deletedAt: true,
        links: { select: { entityType: true, entityId: true } },
        uploadedBy: {
          select: { id: true, user: { select: { name: true, email: true } } },
        },
      },
    });

    if (view.scope === "all") return documents;

    // Documents linked to a unit-scoped record are only visible when that
    // record is. Unlinked documents — house rules, the proprietary lease — are
    // building-wide reference material and stay visible to every member.
    const visibleUnits = new Set(view.scope === "units" ? view.unitIds : []);
    const unitLinked = await unitIdsByEntity(tx, documents);

    return documents.filter((doc) => {
      const owningUnits = doc.links
        .map((link) => unitLinked.get(`${link.entityType}:${link.entityId}`))
        .filter((id): id is string => Boolean(id));

      if (owningUnits.length === 0) return true;
      return owningUnits.some((unitId) => visibleUnits.has(unitId));
    });
  });
}

/**
 * Maps each linked entity to the unit it belongs to, so document visibility can
 * follow the visibility of whatever the document is attached to.
 */
async function unitIdsByEntity(
  tx: Parameters<Parameters<typeof withBuildingTx>[1]>[0],
  documents: Array<{ links: Array<{ entityType: EntityType; entityId: string }> }>,
): Promise<Map<string, string>> {
  const byType = new Map<EntityType, Set<string>>();
  for (const doc of documents) {
    for (const link of doc.links) {
      const set = byType.get(link.entityType) ?? new Set<string>();
      set.add(link.entityId);
      byType.set(link.entityType, set);
    }
  }

  const out = new Map<string, string>();

  const alterationIds = [...(byType.get("ALTERATION_REQUEST") ?? [])];
  if (alterationIds.length > 0) {
    const rows = await tx.alterationRequest.findMany({
      where: { id: { in: alterationIds } },
      select: { id: true, unitId: true },
    });
    for (const row of rows) out.set(`ALTERATION_REQUEST:${row.id}`, row.unitId);
  }

  const ticketIds = [...(byType.get("TICKET") ?? [])];
  if (ticketIds.length > 0) {
    const rows = await tx.ticket.findMany({
      where: { id: { in: ticketIds } },
      select: { id: true, unitId: true },
    });
    for (const row of rows) {
      if (row.unitId) out.set(`TICKET:${row.id}`, row.unitId);
    }
  }

  const unitIds = [...(byType.get("UNIT") ?? [])];
  for (const id of unitIds) out.set(`UNIT:${id}`, id);

  return out;
}

export async function getDocument(ctx: BuildingContext, documentId: string) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.document.findUnique({
      where: { id: documentId },
      include: { links: true },
    }),
  );
}

export async function listDocumentLinks(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.documentLink.findMany({
      select: {
        id: true,
        buildingId: true,
        documentId: true,
        entityType: true,
        entityId: true,
      },
    }),
  );
}

/**
 * Certificates of insurance.
 *
 * Building-wide by capability: `coi.view` is in every member's base set,
 * because a lapsed mover's COI on the freight elevator is everyone's exposure.
 * The certificate carries a name and a policy number, not anyone's finances.
 */
export async function listCertificates(
  ctx: BuildingContext,
  options: { expiringWithinDays?: number } = {},
) {
  assertCan(ctx, "coi.view");

  const cutoff =
    options.expiringWithinDays === undefined
      ? undefined
      : new Date(Date.now() + options.expiringWithinDays * 86_400_000);

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.certificateOfInsurance.findMany({
      where: cutoff ? { expiresOn: { lte: cutoff } } : {},
      orderBy: { expiresOn: "asc" },
      select: {
        id: true,
        buildingId: true,
        holderKind: true,
        holderName: true,
        unitId: true,
        alterationRequestId: true,
        carrier: true,
        policyNumber: true,
        coverageCents: true,
        effectiveOn: true,
        expiresOn: true,
        additionalInsuredVerified: true,
        verifiedAt: true,
        documentId: true,
        obligationId: true,
        unit: { select: { id: true, label: true } },
        verifiedBy: {
          select: { id: true, user: { select: { name: true, email: true } } },
        },
      },
    }),
  );
}

export async function getCertificate(ctx: BuildingContext, certificateId: string) {
  assertCan(ctx, "coi.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.certificateOfInsurance.findUnique({
      where: { id: certificateId },
      include: {
        unit: { select: { id: true, label: true } },
        document: true,
        alteration: { select: { id: true, title: true, unitId: true } },
        verifiedBy: {
          select: { id: true, user: { select: { name: true, email: true } } },
        },
      },
    }),
  );
}

/** Whether this member may be issued a download link for a document. */
export async function canDownload(
  ctx: BuildingContext,
  documentId: string,
): Promise<boolean> {
  if (can(ctx, "document.viewAll")) {
    const doc = await getDocument(ctx, documentId);
    return doc !== null && doc.deletedAt === null;
  }

  const visible = await listDocuments(ctx);
  return visible.some((doc) => doc.id === documentId);
}

/** Unfiltered reads used by the tenancy suite. */
export async function listDocumentsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.document.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listCertificatesForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.certificateOfInsurance.findMany({ select: { id: true, buildingId: true } }),
  );
}
