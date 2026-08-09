import Link from "next/link";
import { EmptyState, PageHeader } from "~/components/patterns/PageHeader";
import { can } from "~/lib/auth/capabilities";
import { getBuildingContext } from "~/lib/auth/current";
import { listUnits } from "~/lib/db/scoped/units";
import { NewAlterationForm } from "./NewAlterationForm";

export default async function NewAlterationPage({
  params,
}: {
  params: Promise<{ buildingSlug: string }>;
}) {
  const { buildingSlug } = await params;
  const ctx = await getBuildingContext(buildingSlug);

  const all = await listUnits(ctx);

  // A shareholder files for their own apartment. Officers who can see every
  // unit may file on someone's behalf — in a twelve-unit building the secretary
  // routinely types things up for a neighbour who doesn't use email.
  const units = can(ctx, "alteration.viewAll")
    ? all
    : all.filter((unit) => ctx.unitIds.includes(unit.id));

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/b/${buildingSlug}/alterations`}
            className="underline underline-offset-4"
          >
            Alterations
          </Link>
        }
        title="File an alteration request"
        lede="Work that changes plumbing, walls or the riser needs the board's approval before it starts."
      />

      {units.length === 0 ? (
        <EmptyState title="No apartment on your membership">
          Alteration requests are filed against an apartment. Ask the board to
          link your membership to yours.
        </EmptyState>
      ) : (
        <NewAlterationForm
          buildingSlug={buildingSlug}
          units={units.map((unit) => ({ id: unit.id, label: unit.label }))}
        />
      )}
    </>
  );
}
