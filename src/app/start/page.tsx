import Link from "next/link";
import { redirect } from "next/navigation";
import { getMemberBuildings, sessionUserId } from "~/lib/auth/current";
import { env } from "~/lib/env";
import { NewBuildingForm } from "./NewBuildingForm";

/**
 * Setting a building up.
 *
 * The front door, and until now the product did not have one. Every other way
 * in is invitation-shaped — a member with `member.invite` sends a link, and the
 * link makes a membership in a building that already exists — which is the
 * right shape for everybody except the first person, who has nobody to be
 * invited by.
 *
 * Deliberately outside `/b/[buildingSlug]`: there is no building yet, so there
 * is no context to resolve and no shell to render inside. It reads like the
 * sign-in page rather than like a module page, because at this point in
 * somebody's life with Co-operator it is closer to one.
 */

export default async function StartPage() {
  const userId = await sessionUserId();
  if (!userId) redirect("/sign-in?next=/start");

  if (!env().ALLOW_NEW_BUILDINGS) redirect("/");

  // Not a redirect. Somebody who already runs one co-op and has bought into a
  // second is rare but real, and the seeded `marta.oyelaran` exists precisely
  // because two buildings is a case this product takes seriously.
  const existing = await getMemberBuildings();

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <header className="mb-8">
        <p className="eyebrow">Co-operator</p>
        <h1 className="font-display text-brownstone mt-2 text-3xl leading-tight">
          Set up your building
        </h1>
        <p className="text-ironwork-soft mt-3 max-w-2xl text-sm">
          Start with the address. Most of what follows is already published by the city,
          so this is usually a matter of checking rather than typing. Nothing here is
          final — every number can be corrected later, and the compliance calendar stays
          empty until your board confirms which rules apply.
        </p>
      </header>

      {existing.length > 0 ? (
        <p className="text-ironwork-soft border-limestone mb-6 border-l-2 pl-3 text-sm">
          You already belong to{" "}
          {existing.map((building, index) => (
            <span key={building.id}>
              {index > 0 ? ", " : ""}
              <Link
                href={`/b/${building.slug}`}
                className="text-verdigris underline underline-offset-4"
              >
                {building.name}
              </Link>
            </span>
          ))}
          . This makes a second, separate one.
        </p>
      ) : null}

      <NewBuildingForm />
    </main>
  );
}
