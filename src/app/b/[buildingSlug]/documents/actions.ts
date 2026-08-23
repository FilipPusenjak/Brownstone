"use server";

import { revalidatePath } from "next/cache";
import type { DocumentType, EntityType } from "~/generated/prisma/enums";
import { CapabilityError } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import {
  attachDocument,
  requestUpload,
  type UploadTicket,
} from "~/lib/db/scoped/document-writes";
import { fail, type Result } from "~/lib/result";

/**
 * Uploading a file, for whatever it is being attached to.
 *
 * These began inside the alterations module and moved here when repair tickets
 * became the second caller. Nothing about signing a PUT or recording that the
 * bytes landed is specific to a kitchen renovation, and two copies of an upload
 * path is two places for the permission check to drift.
 *
 * The capability check itself is not here — it is in `document-writes.ts`, in
 * one `canAttachTo` that every path asks. A new entity type has to add its case
 * there deliberately rather than inheriting access by omission.
 */

async function guard<T>(
  buildingSlug: string,
  run: (ctx: Awaited<ReturnType<typeof getBuildingContext>>) => Promise<Result<T>>,
): Promise<Result<T>> {
  try {
    return await run(await getBuildingContext(buildingSlug));
  } catch (error) {
    if (error instanceof NotSignedInError) {
      return fail("unauthenticated", "Your session has expired. Sign in again.");
    }
    if (error instanceof NoSuchBuildingError) {
      return fail("not_found", "You're not a member of this building.");
    }
    if (error instanceof CapabilityError) {
      return fail("forbidden", "You don't have permission to do that.");
    }
    throw error;
  }
}

export async function requestUploadAction(input: {
  buildingSlug: string;
  entityType: EntityType;
  entityId: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
}): Promise<Result<UploadTicket>> {
  const { buildingSlug, ...rest } = input;
  return guard(buildingSlug, (ctx) => requestUpload(ctx, rest));
}

export async function attachDocumentAction(input: {
  buildingSlug: string;
  key: string;
  entityType: EntityType;
  entityId: string;
  type: DocumentType;
  title: string;
  contentType: string;
  sizeBytes: number;
}): Promise<Result<{ documentId: string }>> {
  const { buildingSlug, ...rest } = input;
  const result = await guard(buildingSlug, (ctx) => attachDocument(ctx, rest));
  if (result.ok) refreshFor(buildingSlug, rest.entityType, rest.entityId);
  return result;
}

/**
 * Revalidates the pages a newly attached document shows up on.
 *
 * Keyed off the entity type rather than left to each caller, so a module that
 * adds uploads gets the refresh by naming itself here once — the alternative is
 * a page that silently keeps showing yesterday's attachments.
 */
function refreshFor(
  buildingSlug: string,
  entityType: EntityType,
  entityId: string,
): void {
  revalidatePath(`/b/${buildingSlug}/documents`);

  switch (entityType) {
    case "ALTERATION_REQUEST":
      revalidatePath(`/b/${buildingSlug}/alterations`);
      revalidatePath(`/b/${buildingSlug}/alterations/${entityId}`);
      break;
    case "CERTIFICATE_OF_INSURANCE":
      revalidatePath(`/b/${buildingSlug}/insurance`);
      break;
    case "TICKET":
      revalidatePath(`/b/${buildingSlug}/tickets`);
      revalidatePath("/b/[buildingSlug]/tickets/[ticketId]", "page");
      break;
    case "OBLIGATION":
      revalidatePath(`/b/${buildingSlug}/compliance`);
      revalidatePath("/b/[buildingSlug]/compliance/[obligationId]", "page");
      break;
    default:
      revalidatePath(`/b/${buildingSlug}`);
  }
}
