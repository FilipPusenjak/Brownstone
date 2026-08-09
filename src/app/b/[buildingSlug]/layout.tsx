import { notFound, redirect } from "next/navigation";
import { AppShell } from "~/components/patterns/AppShell";
import { getBuildingContext } from "~/lib/auth/current";
import type { BuildingContext } from "~/lib/db/context";
import { NoSuchBuildingError, NotSignedInError } from "~/lib/db/context";

/**
 * The one place a BuildingContext is resolved.
 *
 * Everything below this layout can assume a signed-in member of an existing
 * building. Pages re-request the context through `getBuildingContext`, which is
 * memoised for the render pass, so asking for it again is free.
 *
 * The two failure modes are deliberately different: not signed in sends you to
 * sign in, but *not a member* is a 404 rather than a 403. A 403 would confirm
 * that a building exists at that slug, which is a small leak but a real one.
 */
export default async function BuildingLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;

  // Only the resolution is guarded. Building JSX inside the try would not catch
  // render errors anyway — React renders the element later — and would swallow
  // the redirect and notFound signals, which travel as thrown values.
  let ctx: BuildingContext;
  try {
    ctx = await getBuildingContext(buildingSlug);
  } catch (error) {
    if (error instanceof NotSignedInError) redirect("/sign-in");
    if (error instanceof NoSuchBuildingError) notFound();
    throw error;
  }

  return (
    <AppShell ctx={ctx}>{children}</AppShell>
  );
}
