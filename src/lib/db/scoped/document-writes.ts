import type { DocumentType, EntityType } from "~/generated/prisma/enums";
import { assertCan, can } from "~/lib/auth/capabilities";
import { fail, ok, type Result } from "~/lib/result";
import {
  keyBelongsTo,
  storage,
  storageKey,
  validateUpload,
  type PresignedUpload,
} from "~/lib/storage";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { recordAudit } from "./audit";

/**
 * Uploading and downloading documents.
 *
 * The browser PUTs straight to object storage over a presigned URL, so a 20 MB
 * scan never passes through a serverless function. Two consequences shape this
 * module:
 *
 *   The client is assumed to be lying. Content type, size and filename all
 *   arrive from the browser, and the presigned URL is issued on the strength of
 *   them, so they are validated server-side before anything is signed.
 *
 *   Nothing is ever public. A download is a short-lived presigned GET issued
 *   only after a capability check, so a document link stops working when
 *   someone leaves the board rather than living forever in an inbox.
 */

export interface UploadTicket extends PresignedUpload {
  readonly entityType: EntityType;
  readonly entityId: string;
}

/** Issues a presigned PUT. The Document row is written after the upload lands. */
export async function requestUpload(
  ctx: BuildingContext,
  input: {
    entityType: EntityType;
    entityId: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
  },
): Promise<Result<UploadTicket>> {
  assertCan(ctx, "document.upload");

  const validation = validateUpload(input);
  if (!validation.ok)
    return fail("invalid", validation.message, { file: validation.message });

  const allowed = await canAttachTo(ctx, input.entityType, input.entityId);
  if (!allowed) {
    return fail("forbidden", "You don't have access to that record.");
  }

  const key = storageKey({
    buildingId: ctx.building.id,
    entity: input.entityType,
    entityId: input.entityId,
    // Prefixed so two people uploading "scan.pdf" to the same request do not
    // collide, and so the key stays unique without a database round trip.
    filename: `${Date.now()}-${validation.filename}`,
  });

  const presigned = await storage().presignUpload({
    key,
    contentType: input.contentType,
    contentLength: input.sizeBytes,
  });

  return ok({ ...presigned, entityType: input.entityType, entityId: input.entityId });
}

/** Records the document once the browser reports the upload succeeded. */
export async function attachDocument(
  ctx: BuildingContext,
  input: {
    key: string;
    entityType: EntityType;
    entityId: string;
    type: DocumentType;
    title: string;
    contentType: string;
    sizeBytes: number;
  },
): Promise<Result<{ documentId: string }>> {
  assertCan(ctx, "document.upload");

  // The key came back from the browser. It was minted here, but a caller could
  // send any string, and a key pointing at another building would attach that
  // building's file to this one's record.
  if (!keyBelongsTo(input.key, ctx.building.id)) {
    return fail("forbidden", "That upload doesn't belong to this building.");
  }

  const allowed = await canAttachTo(ctx, input.entityType, input.entityId);
  if (!allowed) return fail("forbidden", "You don't have access to that record.");

  if (!(await storage().exists(input.key))) {
    return fail("invalid", "That upload didn't finish. Try again.");
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const document = await tx.document.create({
      data: {
        buildingId: ctx.building.id,
        type: input.type,
        title: input.title.trim() || "Untitled",
        storageKey: input.key,
        contentType: input.contentType,
        sizeBytes: input.sizeBytes,
        uploadedById: ctx.membership.id,
      },
      select: { id: true },
    });

    await tx.documentLink.create({
      data: {
        buildingId: ctx.building.id,
        documentId: document.id,
        entityType: input.entityType,
        entityId: input.entityId,
      },
    });

    await recordAudit(tx, ctx, {
      action: "document.upload",
      entityType: "DOCUMENT",
      entityId: document.id,
      after: { title: input.title, linkedTo: `${input.entityType}:${input.entityId}` },
      summary: `${input.title} uploaded`,
    });

    return ok({ documentId: document.id });
  });
}

/**
 * Issues a short-lived download link, after checking this member may see the
 * record the document is attached to.
 */
export async function requestDownload(
  ctx: BuildingContext,
  documentId: string,
): Promise<Result<{ url: string }>> {
  const document = await withBuildingTx(ctx.building.id, (tx) =>
    tx.document.findUnique({
      where: { id: documentId },
      select: {
        id: true,
        title: true,
        storageKey: true,
        deletedAt: true,
        links: { select: { entityType: true, entityId: true } },
      },
    }),
  );

  if (!document || document.deletedAt) {
    return fail("not_found", "That document isn't available.");
  }
  if (!keyBelongsTo(document.storageKey, ctx.building.id)) {
    return fail("forbidden", "That document doesn't belong to this building.");
  }

  if (!can(ctx, "document.viewAll")) {
    // Unlinked documents are building-wide reference material. Linked ones
    // inherit the visibility of whatever they are attached to, so a shareholder
    // who may not see 4F's alteration may not see its plans either.
    const checks = await Promise.all(
      document.links.map((link) => canAttachTo(ctx, link.entityType, link.entityId)),
    );
    if (document.links.length > 0 && !checks.some(Boolean)) {
      return fail("forbidden", "You don't have access to that document.");
    }
  }

  const filename = document.storageKey.split("/").pop() ?? "document";
  const url = await storage().presignDownload(document.storageKey, filename);
  return ok({ url });
}

export async function deleteDocument(
  ctx: BuildingContext,
  documentId: string,
): Promise<Result<null>> {
  assertCan(ctx, "document.delete");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const document = await tx.document.findUnique({
      where: { id: documentId },
      select: { id: true, title: true, deletedAt: true },
    });
    if (!document) return fail("not_found", "That document isn't available.");

    // Soft delete only. A document referenced by a decision is part of that
    // decision, and there is no hard-delete path anywhere in the application.
    await tx.document.update({
      where: { id: document.id },
      data: { deletedAt: new Date() },
    });

    await recordAudit(tx, ctx, {
      action: "document.delete",
      entityType: "DOCUMENT",
      entityId: document.id,
      before: { title: document.title },
      summary: `${document.title} removed`,
    });

    return ok(null);
  });
}

/**
 * Whether this member may attach to, or read documents from, a given record.
 *
 * Centralised because it is asked on the upload path, the attach path and the
 * download path, and three copies would eventually disagree.
 */
async function canAttachTo(
  ctx: BuildingContext,
  entityType: EntityType,
  entityId: string,
): Promise<boolean> {
  return withBuildingTx(ctx.building.id, async (tx) => {
    switch (entityType) {
      case "ALTERATION_REQUEST": {
        const row = await tx.alterationRequest.findUnique({
          where: { id: entityId },
          select: { unitId: true },
        });
        if (!row) return false;
        return can(ctx, "alteration.viewAll") || ctx.unitIds.includes(row.unitId);
      }
      case "CERTIFICATE_OF_INSURANCE": {
        const row = await tx.certificateOfInsurance.findUnique({
          where: { id: entityId },
          select: { unitId: true },
        });
        if (!row) return false;
        if (can(ctx, "coi.manage") || can(ctx, "document.viewAll")) return true;
        return row.unitId === null || ctx.unitIds.includes(row.unitId);
      }
      case "UNIT":
        return can(ctx, "document.viewAll") || ctx.unitIds.includes(entityId);
      case "OBLIGATION":
      case "BUILDING":
        // Building-wide records: any active member may attach the receipt for a
        // filing they made.
        return can(ctx, "compliance.view");
      case "TICKET": {
        const row = await tx.ticket.findUnique({
          where: { id: entityId },
          select: { unitId: true },
        });
        if (!row) return false;
        if (can(ctx, "ticket.viewAll")) return true;
        return row.unitId === null || ctx.unitIds.includes(row.unitId);
      }
      default:
        // Unknown entity types fail closed. A new module adds its case here
        // deliberately rather than inheriting access by omission.
        return false;
    }
  });
}
