import { afterEach, describe, expect, it } from "vitest";
import { resetEnvCache } from "~/lib/env";
import {
  attachmentDisposition,
  downloadResponse,
  storage,
  storageKey,
} from "~/lib/storage";

/**
 * Which storage backend runs, and how a file comes back from it.
 *
 * Nothing here talks to a bucket. What is worth pinning is the part that is
 * decided before any network call: that the driver is chosen by configuration
 * and not by a default that silently persists a co-op's certificates to a
 * filesystem Vercel throws away, and that every download leaves as an
 * attachment under a name that cannot break the header it sits in.
 */

const SAVED = { ...process.env };

afterEach(() => {
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED)) delete process.env[key];
  }
  Object.assign(process.env, SAVED);
  resetEnvCache();
});

function configured(overrides: Record<string, string>): void {
  Object.assign(process.env, overrides);
  resetEnvCache();
}

describe("choosing a driver", () => {
  const KEY = "buildings/x/alteration_request/y/a.pdf";

  it("signs a local URL when nothing says otherwise", async () => {
    configured({ STORAGE_DRIVER: "local" });
    const download = await storage().download(KEY, "a.pdf");

    expect(download.kind).toEqual("redirect");
    expect(download.kind === "redirect" && download.url).toContain("/api/files/local/");
  });

  it("signs a bucket URL when S3 is selected", async () => {
    configured({
      STORAGE_DRIVER: "s3",
      S3_BUCKET: "cooperator",
      S3_ENDPOINT: "https://example.r2.cloudflarestorage.com",
      S3_ACCESS_KEY_ID: "x",
      S3_SECRET_ACCESS_KEY: "y",
    });
    const download = await storage().download(KEY, "a.pdf");

    // Signed locally by the AWS SDK, so this needs no bucket to exist.
    expect(download.kind === "redirect" && download.url).toContain("X-Amz-Signature");
  });

  it("never hands back a redirect when Blob is selected", async () => {
    // The failure this guards against is silent and expensive: a deployment
    // that means to use Vercel Blob but quietly writes to a Vercel filesystem
    // reports every upload as a success, and the building's certificates are
    // gone at the next deploy. The Blob driver streams; it must never resolve
    // to a URL, whether the store answers or not.
    configured({
      STORAGE_DRIVER: "blob",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_notarealstore_notarealkey",
    });

    const outcome = await storage()
      .download(KEY, "a.pdf")
      .catch(() => "refused" as const);

    expect(outcome).not.toMatchObject({ kind: "redirect" });
  });

  it("refuses to boot on Blob without a token rather than using the disk", async () => {
    configured({ STORAGE_DRIVER: "blob" });
    delete process.env["BLOB_READ_WRITE_TOKEN"];
    resetEnvCache();

    // An async wrapper, because refusing at configuration time and refusing at
    // call time are both fine — what matters is that a URL never comes back.
    await expect(async () => storage().download(KEY, "a.pdf")).rejects.toThrow(
      /BLOB_READ_WRITE_TOKEN/,
    );
  });
});

describe("how a download is served", () => {
  it("is always an attachment", async () => {
    // A PDF rendered inline runs in the origin that served it, and a co-op's
    // document store is exactly where somebody uploads something they should
    // not have.
    expect(attachmentDisposition("bergen-street_COI.2026.pdf")).toEqual(
      'attachment; filename="bergen-street_COI.2026.pdf"',
    );
  });

  it("cannot be broken out of by a filename", () => {
    // A quote closes the filename, a newline starts another header. Both are
    // gone by the time the name reaches here, and this is the assertion that
    // says so at the header rather than at the sanitiser.
    for (const hostile of [
      'a".pdf',
      "a\r\nSet-Cookie: x=1.pdf",
      "a; filename=other.pdf",
      "../../etc/passwd",
    ]) {
      const header = attachmentDisposition(hostile);
      expect(header.startsWith('attachment; filename="')).toBe(true);
      expect(header.endsWith('"')).toBe(true);
      expect(header.slice('attachment; filename="'.length, -1)).not.toMatch(
        /["\r\n;/\\]/,
      );
    }
  });

  it("falls back to a usable name rather than an empty one", () => {
    expect(attachmentDisposition("...")).toEqual('attachment; filename="document"');
    expect(attachmentDisposition("")).toEqual('attachment; filename="document"');
  });
});

describe("the response streamed bytes leave in", () => {
  function streamOf(text: string): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
  }

  function respond(overrides: Partial<{ contentType: string; contentLength: number | null }> = {}) {
    return downloadResponse(
      {
        kind: "stream",
        body: streamOf("%PDF-1.7"),
        contentType: overrides.contentType ?? "application/pdf",
        contentLength: overrides.contentLength === undefined ? 8 : overrides.contentLength,
      },
      "bergen-street_COI.2026.pdf",
    );
  }

  it("hands the file over as an attachment under its own name", async () => {
    const response = respond();
    expect(response.headers.get("content-disposition")).toEqual(
      'attachment; filename="bergen-street_COI.2026.pdf"',
    );
    expect(response.headers.get("content-type")).toEqual("application/pdf");
    expect(await response.text()).toEqual("%PDF-1.7");
  });

  it("is never cached anywhere", async () => {
    // The capability check that authorised these bytes was about one member,
    // and the next request is somebody else. The browser's disk cache is the
    // copy that outlives leaving the board.
    const cacheControl = respond().headers.get("cache-control") ?? "";
    expect(cacheControl).toContain("no-store");
    expect(cacheControl).toContain("private");
  });

  it("does not let the browser second-guess the type", async () => {
    // The content type came from whoever uploaded the file. Sniffing is
    // letting the uploader choose what it gets treated as.
    expect(respond().headers.get("x-content-type-options")).toEqual("nosniff");
  });

  it("omits the length rather than guessing when the store did not say", async () => {
    expect(respond({ contentLength: null }).headers.get("content-length")).toBeNull();
    expect(respond().headers.get("content-length")).toEqual("8");
  });
});

describe("keys", () => {
  it("namespace every file under its building", () => {
    // The same shape whichever driver stores it, so a key is self-describing
    // and `keyBelongsTo` can be the backstop on the download path.
    const key = storageKey({
      buildingId: "11111111-2222-3333-4444-555555555555",
      entity: "ALTERATION_REQUEST",
      entityId: "66666666-7777-8888-9999-000000000000",
      filename: "scan.pdf",
    });
    expect(key).toEqual(
      "buildings/11111111-2222-3333-4444-555555555555/alteration_request/66666666-7777-8888-9999-000000000000/scan.pdf",
    );
  });
});
