import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signLocalUrl } from "~/lib/storage/local";

/**
 * Every URL this application mints is served by a route that exists.
 *
 * This test exists because of a bug it would have caught immediately. The
 * filesystem storage driver signs upload and download URLs at
 * `/api/files/local/put` and `/api/files/local/get`; the route handler sat at
 * `/api/files/local`. Every upload and every download on the development
 * driver answered 404, and had done for as long as the driver existed.
 *
 * Nothing noticed, and the reason is worth stating: `tests/storage/drivers.test.ts`
 * asserts what the driver *builds* — that the local URL contains
 * `/api/files/local/`, that the S3 one carries a signature — which is the right
 * thing for those tests to assert and says nothing at all about whether a route
 * answers. A URL is a claim about the server, and only the server can settle
 * it. It took an end-to-end test putting a real file through the round trip to
 * surface, which is a slow way to learn something a directory listing knows.
 *
 * So: cheap, static, and about the one thing the other tests structurally
 * cannot see.
 */

const APP = join(import.meta.dirname, "..", "..", "src", "app");

/**
 * Resolves a URL path against the App Router's directory layout.
 *
 * At each segment, an exactly-named directory wins; failing that, a single
 * dynamic segment (`[action]`, `[documentId]`) matches anything. Catch-alls are
 * accepted at the point they appear, since they swallow the rest of the path.
 */
function routeExistsFor(pathname: string): boolean {
  const segments = pathname.split("/").filter(Boolean);
  let dir = APP;

  for (const segment of segments) {
    const exact = join(dir, segment);
    if (existsSync(exact)) {
      dir = exact;
      continue;
    }

    const entries = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("["))
      .map((entry) => entry.name);

    if (entries.some((name) => name.startsWith("[..."))) return true;

    const dynamic = entries[0];
    if (!dynamic) return false;
    dir = join(dir, dynamic);
  }

  return existsSync(join(dir, "route.ts")) || existsSync(join(dir, "route.tsx"));
}

describe("the URLs the application hands out", () => {
  it("are served by routes that exist", () => {
    // Signed with throwaway values: only the path matters here, and the
    // signature is checked by the handler rather than by the router.
    const minted = (["put", "get"] as const).map(
      (action) =>
        new URL(signLocalUrl(action, "buildings/x/y/z.pdf", Date.now())).pathname,
    );

    // Named individually so a failure says which one, rather than "an array
    // did not equal an array".
    for (const pathname of minted) {
      expect(routeExistsFor(pathname), `${pathname} has no route`).toBe(true);
    }
  });

  it("includes the capability-checked download the whole document store hangs off", () => {
    // Built by `DocumentLink` rather than by a signing helper, so it is spelled
    // out here rather than derived. A document store whose download URL 404s
    // is not a document store.
    expect(routeExistsFor("/api/files/00000000-0000-0000-0000-000000000000")).toBe(
      true,
    );
  });

  it("would notice a route that moved out from under one", () => {
    // The assertion above is only worth anything if the resolver can say no.
    expect(routeExistsFor("/api/files/local/put/deeper")).toBe(false);
    expect(routeExistsFor("/api/nothing-here")).toBe(false);
  });
});
