import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { env } from "~/lib/env";
import type { PresignedUpload, StorageDriver } from "./index";

/**
 * Filesystem storage for development.
 *
 * Implements the same presigned-URL shape as the S3 driver — the browser still
 * PUTs to a URL it was handed, and still cannot read a document without a
 * signed link — so the upload and download paths are exercised for real without
 * any cloud credentials. Signatures use AUTH_SECRET and carry an expiry, so
 * even locally a stale link stops working.
 *
 * Not for production: `env.ts` refuses to boot with this driver selected there,
 * because a Vercel filesystem is ephemeral and the building's certificates
 * would quietly vanish on the next deploy.
 */

const ROOT = resolve(process.cwd(), "storage");
const UPLOAD_TTL_SECONDS = 900;
const DOWNLOAD_TTL_SECONDS = 300;

function sign(parts: string[]): string {
  return createHmac("sha256", env().AUTH_SECRET).update(parts.join("\n")).digest("hex");
}

export function signLocalUrl(
  action: "put" | "get",
  key: string,
  expiresAt: number,
): string {
  const signature = sign([action, key, String(expiresAt)]);
  const params = new URLSearchParams({
    key,
    expires: String(expiresAt),
    signature,
  });
  return `${env().AUTH_URL}/api/files/local/${action}?${params.toString()}`;
}

export function verifyLocalUrl(input: {
  action: "put" | "get";
  key: string;
  expires: string;
  signature: string;
}): { ok: true } | { ok: false; reason: string } {
  const expiresAt = Number(input.expires);
  if (!Number.isFinite(expiresAt)) return { ok: false, reason: "Malformed link." };
  if (Date.now() > expiresAt) return { ok: false, reason: "This link has expired." };

  const expected = sign([input.action, input.key, input.expires]);
  // Length-safe comparison; both are hex digests of the same length.
  if (expected.length !== input.signature.length || expected !== input.signature) {
    return { ok: false, reason: "This link isn't valid." };
  }
  return { ok: true };
}

/** Resolves a key to a path, refusing anything that escapes the storage root. */
export function localPathFor(key: string): string {
  const path = resolve(join(ROOT, key));
  if (path !== ROOT && !path.startsWith(ROOT + "/")) {
    throw new Error("Storage key escapes the storage root");
  }
  return path;
}

export function localStorageDriver(): StorageDriver {
  return {
    async presignUpload({ key, contentType }): Promise<PresignedUpload> {
      await mkdir(dirname(localPathFor(key)), { recursive: true });
      const expiresAt = Date.now() + UPLOAD_TTL_SECONDS * 1000;

      return {
        url: signLocalUrl("put", key, expiresAt),
        method: "PUT",
        headers: { "content-type": contentType },
        key,
        expiresInSeconds: UPLOAD_TTL_SECONDS,
      };
    },

    async presignDownload(key: string, filename: string): Promise<string> {
      const expiresAt = Date.now() + DOWNLOAD_TTL_SECONDS * 1000;
      const url = new URL(signLocalUrl("get", key, expiresAt));
      url.searchParams.set("filename", filename);
      return url.toString();
    },

    async delete(key: string): Promise<void> {
      await rm(localPathFor(key), { force: true });
    },

    async exists(key: string): Promise<boolean> {
      return existsSync(localPathFor(key));
    },
  };
}
