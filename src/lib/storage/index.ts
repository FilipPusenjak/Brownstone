import { env } from "~/lib/env";
import { blobStorageDriver } from "./blob";
import { localStorageDriver } from "./local";
import { s3StorageDriver } from "./s3";

/**
 * Object storage, behind an interface.
 *
 * Three drivers. Vercel Blob is the one this deploys on, because it is what the
 * hosting account already has and needs no bucket, no keys and no second
 * vendor. An S3-compatible driver covers Cloudflare R2 and AWS proper for
 * anyone who would rather own the bucket. And a filesystem driver runs in
 * development so the whole upload path is exercised without credentials.
 *
 * Two rules hold whichever driver is in use:
 *
 *   Keys are namespaced `buildings/{buildingId}/{entity}/{id}/{filename}`, so a
 *   key is self-describing and a misdirected write is visible at a glance.
 *
 *   Nothing is ever public. Every file is reached only after a capability
 *   check, so there is no such thing as a document URL that keeps working once
 *   someone leaves the board.
 *
 * How a file *comes back* is the one thing the drivers genuinely disagree
 * about, so the interface lets each say what it can do best rather than
 * forcing the weaker answer on both. An S3 presigned GET carries the filename
 * and `Content-Disposition: attachment` inside the signature, so the browser
 * can be redirected straight at the bucket and the bytes never touch a
 * function. A Vercel Blob presigned GET cannot carry either, and a PDF served
 * inline from the storage origin is the thing that disposition header is
 * there to prevent — so that driver streams through the application instead,
 * where the header is ours to set. Uploads still go direct in both cases,
 * which is the direction where 20 MB of scanned certificate actually matters.
 */

export interface PresignedUpload {
  readonly url: string;
  readonly method: "PUT";
  readonly headers: Record<string, string>;
  readonly key: string;
  readonly expiresInSeconds: number;
}

/**
 * How a download reaches the browser.
 *
 * `redirect` hands over a short-lived signed URL and gets out of the way.
 * `stream` passes the bytes through the application, which is what a backend
 * that cannot sign a `Content-Disposition` into its URLs requires.
 */
export type Download =
  | { readonly kind: "redirect"; readonly url: string }
  | {
      readonly kind: "stream";
      readonly body: ReadableStream<Uint8Array>;
      readonly contentType: string;
      readonly contentLength: number | null;
    };

export interface StorageDriver {
  presignUpload(input: {
    key: string;
    contentType: string;
    contentLength: number;
  }): Promise<PresignedUpload>;
  download(key: string, filename: string): Promise<Download>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export function storage(): StorageDriver {
  switch (env().STORAGE_DRIVER) {
    case "blob":
      return blobStorageDriver();
    case "s3":
      return s3StorageDriver();
    default:
      return localStorageDriver();
  }
}

/**
 * `Content-Disposition` for a download, with the filename quoted safely.
 *
 * Always an attachment. A PDF or an HTML-ish file rendered inline from a
 * storage origin runs in that origin, and a co-op's document store is exactly
 * the place somebody uploads something they should not.
 */
export function attachmentDisposition(filename: string): string {
  const safe = safeFilename(filename) ?? "document";
  return `attachment; filename="${safe}"`;
}

/**
 * Turns a streamed download into the response that leaves the application.
 *
 * Lives here rather than in the route so the headers are testable without an
 * HTTP round trip, because every one of them is doing a job:
 *
 *   `Content-Disposition: attachment` — a PDF rendered inline runs in the
 *   origin that served it, and here that origin is the application itself.
 *
 *   `no-store, private` — the capability check that authorised these bytes was
 *   about one member. A shared cache must never hand them to the next request,
 *   and the browser's disk cache is the copy that outlives leaving the board.
 *
 *   `nosniff` — the content type came from whoever uploaded the file. Letting a
 *   browser second-guess it is letting the uploader choose.
 */
export function downloadResponse(
  download: Extract<Download, { kind: "stream" }>,
  filename: string,
): Response {
  return new Response(download.body, {
    headers: {
      "content-type": download.contentType,
      "content-disposition": attachmentDisposition(filename),
      "cache-control": "no-store, private",
      "x-content-type-options": "nosniff",
      ...(download.contentLength !== null
        ? { "content-length": String(download.contentLength) }
        : {}),
    },
  });
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
