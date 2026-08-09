import { redirect } from "next/navigation";
import { getMemberBuildings } from "~/lib/auth/current";

export default async function Home() {
  const buildings = await getMemberBuildings();

  // One building is the overwhelmingly common case, so it goes straight there
  // rather than making someone pick from a list of one.
  const first = buildings[0];
  if (buildings.length === 1 && first) redirect(`/b/${first.slug}`);
  if (buildings.length === 0) redirect("/sign-in");

  return (
    <main className="mx-auto max-w-lg px-6 py-20">
      <p className="eyebrow">Co-operator</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">Which building?</h1>
      <ul className="divide-limestone mt-6 divide-y">
        {buildings.map((building) => (
          <li key={building.id}>
            <a
              href={`/b/${building.slug}`}
              className="hover:text-verdigris flex items-baseline justify-between gap-4 py-4"
            >
              <span className="font-display text-xl">{building.name}</span>
              <span className="text-ironwork-faint font-mono text-xs">
                {building.slug}
              </span>
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
