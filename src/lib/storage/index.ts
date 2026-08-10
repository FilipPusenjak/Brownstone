import { env } from "~/lib/env";
import { localStorageDriver } from "./local";
import { s3StorageDriver } from "./s3";

/**
 * Object storage, behind an interface.
 *
 * Cloudflare R2 in production; a filesystem driver in development so the whole
 * upload path can be exercised without credentials. Switching to S3 proper, or
 * to any other S3-compatible bucket, is a change to `.env` and nothing else.
 *
 * Two rules hold whichever driver is in use:
 *
 *   Keys are namespaced `buildings/{buildingId}/{entity}/{id}/{filename}`, so a
 *   key is self-describing and a misdirected write is visible at a glance.
 *
 *   Nothing is ever public. Downloads are short-lived presigned GETs issued
 *   only after a capability check, so there is no such thing as a document URL
 *   that keeps working once someone leaves the board.
 */

export interface PresignedUpload {
  readonly url: string;
  readonly method: "PUT";
  readonly headers: Record<string, string>;
  readonly key: string;
  readonly expiresInSeconds: number;
}

export interface StorageDriver {
  presignUpload(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<PresignedUpload>;
  presignDownload(key: string, filename: string): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export function storage(): StorageDriver {
  return env().STORAGE_DRIVER === "s3" ? s3StorageDriver() : localStorageDriver();
}

/** Types a co-op actually uploads. Anything else is refused server-side. */
export const ALLOWED_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/webp",
] as const;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

export type UploadValidation =
  | { readonly ok: true; readonly filename: string }
  | { readonly ok: false; readonly message: string };

/**
 * Validates an upload request. Assume the client is lying: the content type,
 * the size and the filename all arrive from the browser, and the presigned URL
 * is issued on the strength of them.
 */
export function validateUpload(input: {
  filename: string;
  contentType: string;
  sizeBytes: number;
}): UploadValidation {
  if (!ALLOWED_CONTENT_TYPES.includes(input.contentType as never)) {
    return {
      ok: false,
      message:
        "That file type isn't accepted. Upload a PDF or a photo (JPEG, PNG, HEIC or WebP).",
    };
  }

  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, message: "That file appears to be empty." };
  }

  if (input.sizeBytes > MAX_UPLOAD_BYTES) {
    const mb = Math.round(MAX_UPLOAD_BYTES / 1024 / 1024);
    return {
      ok: false,
      message: `That file is larger than ${mb} MB. Photograph the page rather than scanning at full resolution, or split the document.`,
    };
  }

  const filename = safeFilename(input.filename);
  if (!filename) {
    return { ok: false, message: "That filename can't be used. Rename the file and try again." };
  }

  return { ok: true, filename };
}

/**
 * Strips everything that could escape the key namespace or confuse a storage
 * backend: path separators, traversal, control characters, leading dots.
 */
export function safeFilename(input: string): string | null {
  const base = input.split(/[/\\]/).pop() ?? "";
  const cleaned = base
    // Allow-list rather than deny-list. Enumerating what is dangerous means
    // missing something; keeping only letters, digits, dot, dash and
    // underscore makes a filename safe by construction, control characters
    // and all, whatever arrives from the browser.
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^[.-]+/, "")
    .slice(0, 120);

  return cleaned.length > 0 && cleaned !== "." && cleaned !== ".." ? cleaned : null;
}

/** The one place storage keys are constructed. */
export function storageKey(input: {
  buildingId: string;
  entity: string;
  entityId: string;
  filename: string;
}): string {
  const filename = safeFilename(input.filename);
  if (!filename) throw new Error("Unusable filename");

  return [
    "buildings",
    input.buildingId,
    input.entity.toLowerCase(),
    input.entityId,
    filename,
  ].join("/");
}

/**
 * Confirms a key belongs to a building. Belt and braces on the download path:
 * the capability check already ran, and this catches the case where a document
 * row was written with a key from somewhere else.
 */
export function keyBelongsTo(key: string, buildingId: string): boolean {
  return key.startsWith(`buildings/${buildingId}/`);
}
