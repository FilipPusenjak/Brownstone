import { del, get, head, issueSignedToken, presignUrl } from "@vercel/blob";
import { env } from "~/lib/env";
import type { Download, PresignedUpload, StorageDriver } from "./index";

/**
 * Vercel Blob.
 *
 * The driver this deploys on, because the hosting account already has it and it
 * needs no bucket, no access keys and no second vendor to fall over.
 *
 * **Every blob is private.** Vercel Blob will happily store things at
 * `access: "public"`, which means a permanent unauthenticated URL — unguessable,
 * but forever, and still working the day after somebody leaves the board. That
 * is precisely the thing this product says it does not have. `"private"` is
 * therefore not a setting here, it is a constant: the store is reached only
 * with a short-lived signed URL the application issues after a capability
 * check.
 *
 * **Uploads go straight from the browser.** A presigned PUT, scoped to one
 * pathname, one content type and one exact size, valid for fifteen minutes.
 * Routing a 20 MB scan through a serverless function would hit Vercel's 4.5 MB
 * request body limit long before it hit the file size limit this product sets.
 *
 * **Downloads stream back through the application.** This is the one place the
 * driver is deliberately slower than S3. A Blob presigned GET cannot carry a
 * `Content-Disposition`, and there is no per-request equivalent, so redirecting
 * the browser at the store would serve a PDF inline from the storage origin.
 * Streaming costs a few hundred kilobytes of function bandwidth on a download
 * a twelve-unit co-op does a handful of times a month, and buys back the
 * header — and, incidentally, means the file never has a URL anybody can hold
 * at all.
 */

const UPLOAD_TTL_SECONDS = 900;

function token(): string {
  const value = env().BLOB_READ_WRITE_TOKEN;
  if (!value) throw new Error("BLOB_READ_WRITE_TOKEN is not set.");
  return value;
}

export function blobStorageDriver(): StorageDriver {
  return {
    async presignUpload({ key, contentType, contentLength }): Promise<PresignedUpload> {
      const validUntil = Date.now() + UPLOAD_TTL_SECONDS * 1000;

      // The delegation and the URL carry the same constraints. Both are signed,
      // so a browser handed this URL cannot change the pathname, upload a
      // different type, or present a small file for signing and then send a
      // large one.
      const signed = await issueSignedToken({
        token: token(),
        pathname: key,
        operations: ["put"],
        validUntil,
        allowedContentTypes: [contentType],
        maximumSizeInBytes: contentLength,
      });

      const { presignedUrl } = await presignUrl(signed, {
        operation: "put",
        access: "private",
        pathname: key,
        validUntil: signed.validUntil,
        allowedContentTypes: [contentType],
        maximumSizeInBytes: contentLength,
      });

      return {
        url: presignedUrl,
        method: "PUT",
        headers: {
          "content-type": contentType,
          "content-length": String(contentLength),
        },
        key,
        expiresInSeconds: UPLOAD_TTL_SECONDS,
      };
    },

    async download(key: string): Promise<Download> {
      // `useCache: false` so a file replaced at the same key does not come back
      // from a CDN edge as its previous contents. Documents are rarely
      // overwritten and never hot, so there is nothing to gain from the cache
      // and a stale certificate to lose.
      const result = await get(key, {
        token: token(),
        access: "private",
        useCache: false,
      });

      if (!result || result.statusCode !== 200) {
        throw new Error(`No stored file at ${key}`);
      }

      return {
        kind: "stream",
        body: result.stream,
        contentType: result.blob.contentType,
        contentLength: result.blob.size,
      };
    },

    async delete(key: string): Promise<void> {
      await del(key, { token: token() });
    },

    async exists(key: string): Promise<boolean> {
      try {
        await head(key, { token: token() });
        return true;
      } catch {
        return false;
      }
    },
  };
}