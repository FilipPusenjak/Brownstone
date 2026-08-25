import Link from "next/link";
import { redirect } from "next/navigation";
import { getMemberBuildings, sessionUserId } from "~/lib/auth/current";
import { env } from "~/lib/env";

export default async function Home() {
  const userId = await sessionUserId();
  if (!userId) redirect("/sign-in");

  const buildings = await getMemberBuildings();

  // One building is the overwhelmingly common case, so it goes straight there
  // rather than making someone pick from a list of one.
  const first = buildings[0];
  if (buildings.length === 1 && first) redirect(`/b/${first.slug}`);

  // Signed in and a member of nothing: an invitation that lapsed before it was
  // accepted, a membership ended when an apartment sold — or somebody who has
  // come to set their own building up and has not done it yet. Sending them
  // back to the sign-in page would be a loop, they are signed in, and would
  // look like the password had stopped working.
  //
  // The two ways out are not equivalent and are not offered as though they
  // were. Joining a building is by far the commoner one and needs nothing from
  // this page but an explanation; founding one is rarer, larger, and the only
  // route that exists for the first person in a co-op, who has nobody to be
  // invited by.
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

          {env().ALLOW_NEW_BUILDINGS ? (
            <div className="border-limestone mt-5 border-t pt-5">
              <p className="text-ironwork-soft text-sm">
                If there is no board yet because you are the one starting this, set the
                building up and invite the others from inside it.
              </p>
              <p className="mt-3">
                <Link
                  href="/start"
                  className="border-verdigris bg-verdigris rounded-sheet inline-flex items-center border px-3.5 py-2 text-sm font-medium text-white"
                >
                  Set up a building
                </Link>
              </p>
            </div>
          ) : null}

          <p className="mt-5 text-sm">
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
