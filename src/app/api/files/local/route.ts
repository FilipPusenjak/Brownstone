import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { dirname } from "node:path";
import { createReadStream } from "node:fs";
import { NextResponse } from "next/server";
import { localPathFor, verifyLocalUrl } from "~/lib/storage/local";
import { env } from "~/lib/env";
import { MAX_UPLOAD_BYTES } from "~/lib/storage";

export const runtime = "nodejs";

/**
 * The filesystem storage driver's endpoints.
 *
 * These stand in for the bucket in development so the whole upload and download
 * path can be exercised without cloud credentials. They are not an
 * authentication surface: the signed URL *is* the authorisation, exactly as it
 * is with S3, and both signatures carry an expiry.
 *
 * Refuses to run at all under the S3 driver, so a misconfigured production
 * cannot expose a filesystem endpoint that was only ever meant for a laptop.
 */

function guardDriver(): NextResponse | null {
  if (env().STORAGE_DRIVER !== "local") {
    return NextResponse.json(
      { error: "Local file endpoints are disabled." },
      { status: 404 },
    );
  }
  return null;
}

export async function PUT(request: Request): Promise<NextResponse> {
  const disabled = guardDriver();
  if (disabled) return disabled;

  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const expires = url.searchParams.get("expires") ?? "";
  const signature = url.searchParams.get("signature") ?? "";

  const check = verifyLocalUrl({ action: "put", key, expires, signature });
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 403 });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That file is too large." }, { status: 413 });
  }
  if (!request.body) {
    return NextResponse.json({ error: "No file was sent." }, { status: 400 });
  }

  const path = localPathFor(key);
  await mkdir(dirname(path), { recursive: true });

  // Streamed rather than buffered: a 25 MB certificate should not become 25 MB
  // of resident memory just because this is the development driver.
  await pipeline(
    Readable.fromWeb(request.body as Parameters<typeof Readable.fromWeb>[0]),
    createWriteStream(path),
  );

  const written = await stat(path);
  if (written.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That file is too large." }, { status: 413 });
  }

  return NextResponse.json({ ok: true, size: written.size });
}

export async function GET(request: Request): Promise<Response> {
  const disabled = guardDriver();
  if (disabled) return disabled;

  const url = new URL(request.url);
  const key = url.searchParams.get("key") ?? "";
  const expires = url.searchParams.get("expires") ?? "";
  const signature = url.searchParams.get("signature") ?? "";
  const filename = url.searchParams.get("filename") ?? "document";

  const check = verifyLocalUrl({ action: "get", key, expires, signature });
  if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 403 });

  const path = localPathFor(key);
  try {
    await stat(path);
  } catch {
    return NextResponse.json({ error: "That file is missing." }, { status: 404 });
  }

  const stream = createReadStream(path);
  return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
    headers: {
      // Always an attachment. A PDF rendering inline from the storage origin
      // is a script-execution surface nobody needs.
      "content-disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
      "content-type": "application/octet-stream",
      "cache-control": "private, no-store",
    },
  });
}
