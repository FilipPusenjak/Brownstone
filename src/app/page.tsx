import Link from "next/link";
import { redirect } from "next/navigation";
import { getMemberBuildings, sessionUserId } from "~/lib/auth/current";

export default async function Home() {
  const userId = await sessionUserId();
  if (!userId) redirect("/sign-in");

  const buildings = await getMemberBuildings();

  // One building is the overwhelmingly common case, so it goes straight there
  // rather than making someone pick from a list of one.
  const first = buildings[0];
  if (buildings.length === 1 && first) redirect(`/b/${first.slug}`);

  // Signed in and a member of nothing: an invitation that lapsed before it was
  // accepted, or a membership ended when an apartment sold. Sending them back
  // to the sign-in page would be a loop — they are signed in — and would look
  // like the password had stopped working.
  if (buildings.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
        <div className="sheet px-6 py-7">
          <p className="eyebrow">Co-operator</p>
          <h1 className="font-display text-brownstone mt-2 text-3xl leading-tight">
            You&rsquo;re signed in
          </h1>
          <p className="text-ironwork-soft mt-3 text-sm">
            Your account doesn&rsquo;t belong to a building yet. Membership comes from
            an invitation — ask your board to send one to this address, and opening it
            will bring you straight in.
          </p>
          <p className="mt-4 text-sm">
            <Link
              href="/account"
              className="text-verdigris underline underline-offset-4"
            >
              Your account
            </Link>
          </p>
        </div>
      </main>
    );
  }

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
