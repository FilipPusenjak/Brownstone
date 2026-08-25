import { NextResponse } from "next/server";
import { getBuildingContext } from "~/lib/auth/current";
import { requestDownload } from "~/lib/db/scoped/document-writes";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";
import { downloadResponse } from "~/lib/storage";

export const runtime = "nodejs";

/**
 * Downloading a document.
 *
 * A route handler rather than a Server Action because the browser needs
 * something to follow. It resolves the BuildingContext from the session and the
 * `building` query parameter, checks that this member may see the record the
 * document is attached to, and only then asks storage for the file.
 *
 * What comes back depends on the driver: a short-lived signed URL to redirect
 * to, or the bytes themselves to pass through. Streaming is the slower answer
 * and the one Vercel Blob requires, because only a redirect target can carry
 * `Content-Disposition` in its signature — so when the bytes come through here,
 * this is where the header gets set.
 *
 * There is deliberately no stable, shareable document URL anywhere in the
 * product. A link a departed board member kept in their inbox stops working.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
): Promise<Response> {
  const { documentId } = await context.params;
  const buildingSlug = new URL(request.url).searchParams.get("building");

  if (!buildingSlug) {
    return NextResponse.json({ error: "Which building?" }, { status: 400 });
  }

  try {
    const ctx = await getBuildingContext(buildingSlug);
    const result = await requestDownload(ctx, documentId);

    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : 403;
      return NextResponse.json({ error: result.message }, { status });
    }

    const { download, filename } = result.data;

    if (download.kind === "redirect") {
      return NextResponse.redirect(download.url, { status: 302 });
    }

    return downloadResponse(download, filename);
  } catch (error) {
    if (error instanceof NotSignedInError) {
      return NextResponse.redirect(new URL("/sign-in", request.url), { status: 302 });
    }
    if (error instanceof NoSuchBuildingError) {
      // Deliberately a 404, not a 403: a 403 would confirm the building exists.
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }
    throw error;
  }
}
