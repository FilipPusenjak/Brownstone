import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "~/lib/env";
import { attachmentDisposition, type Download, type PresignedUpload, type StorageDriver } from "./index";

/**
 * S3-compatible object storage. Cloudflare R2 by default; setting S3_ENDPOINT
 * and S3_REGION points it at AWS S3 or anything else speaking the same API.
 *
 * Uploads go straight from the browser to the bucket over a presigned PUT, so
 * a 20 MB scan of a certificate never passes through a serverless function.
 */

const UPLOAD_TTL_SECONDS = 900;
const DOWNLOAD_TTL_SECONDS = 300;

let client: S3Client | undefined;

function s3(): S3Client {
  if (client) return client;

  const config = env();
  client = new S3Client({
    region: config.S3_REGION,
    endpoint: config.S3_ENDPOINT,
    credentials: {
      accessKeyId: config.S3_ACCESS_KEY_ID ?? "",
      secretAccessKey: config.S3_SECRET_ACCESS_KEY ?? "",
    },
    // R2 requires path-style addressing.
    forcePathStyle: true,
  });
  return client;
}

function bucket(): string {
  const name = env().S3_BUCKET;
  if (!name) throw new Error("S3_BUCKET is not set.");
  return name;
}

export function s3StorageDriver(): StorageDriver {
  return {
    async presignUpload({ key, contentType, contentLength }): Promise<PresignedUpload> {
      // ContentLength is signed into the URL, so the browser cannot present a
      // small file for signing and then upload a large one.
      const command = new PutObjectCommand({
        Bucket: bucket(),
        Key: key,
        ContentType: contentType,
        ContentLength: contentLength,
      });

      const url = await getSignedUrl(s3(), command, { expiresIn: UPLOAD_TTL_SECONDS });

      return {
        url,
        method: "PUT",
        headers: {
          "content-type": contentType,
          "content-length": String(contentLength),
        },
        key,
        expiresInSeconds: UPLOAD_TTL_SECONDS,
      };
    },

    async download(key: string, filename: string): Promise<Download> {
      const command = new GetObjectCommand({
        Bucket: bucket(),
        Key: key,
        // Serve under the original filename rather than the storage key, and
        // as an attachment so a PDF cannot render inline from the bucket
        // origin. Both are inside the signature, which is why this driver can
        // redirect the browser at the bucket rather than streaming.
        ResponseContentDisposition: attachmentDisposition(filename),
      });

      return {
        kind: "redirect",
        url: await getSignedUrl(s3(), command, { expiresIn: DOWNLOAD_TTL_SECONDS }),
      };
    },

    async delete(key: string): Promise<void> {
      await s3().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
    },

    async exists(key: string): Promise<boolean> {
      try {
        await s3().send(new HeadObjectCommand({ Bucket: bucket(), Key: key }));
        return true;
      } catch {
        return false;
      }
    },
  };
}
