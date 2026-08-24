import Link from "next/link";
import { redirect } from "next/navigation";
import { hasPassword } from "~/lib/auth/accounts";
import { getMemberBuildings, sessionUserId } from "~/lib/auth/current";
import { withUntenantedTx } from "~/lib/db/tx";
import { PasswordForm } from "./PasswordForm";
import { signOutAction } from "./actions";

/**
 * Your account.
 *
 * Everything on this page is about the person rather than the building, which
 * is why it sits outside `/b/[slug]` — somebody who belongs to two buildings
 * has one password, and somebody who has just been removed from their only
 * building still needs a way to sign out.
 *
 * Deliberately small. A name, an address, a password, the buildings you belong
 * to, and the door. Anything else about a member — their apartment, their
 * roles, their title — belongs to a building and is edited there.
 */
export default async function AccountPage() {
  const userId = await sessionUserId();
  if (!userId) redirect("/sign-in");

  const [user, buildings, password] = await Promise.all([
    withUntenantedTx((tx) =>
      tx.user.findUnique({
        where: { id: userId },
        select: { email: true, name: true, passwordSetAt: true },
      }),
    ),
    getMemberBuildings(),
    hasPassword(userId),
  ]);

  if (!user) redirect("/sign-in");

  return (
    <main className="mx-auto max-w-lg px-6 py-12">
      <p className="eyebrow">Co-operator</p>
      <h1 className="font-display text-brownstone mt-2 text-3xl leading-tight">
        Your account
      </h1>

      <div className="sheet mt-6 px-5 py-5">
        <p className="eyebrow">Signed in as</p>
        <p className="text-ironwork mt-1 font-mono text-sm">{user.email}</p>
        {user.name ? (
          <p className="text-ironwork-soft mt-1 text-sm">{user.name}</p>
        ) : null}
      </div>

      <div className="sheet mt-4 px-5 py-5">
        <h2 className="font-display text-brownstone text-xl">
          {password ? "Change your password" : "Set a password"}
        </h2>
        <p className="text-ironwork-soft mt-1.5 text-sm">
          {password
            ? `Set ${user.passwordSetAt ? user.passwordSetAt.toLocaleDateString("en-US", { dateStyle: "long" }) : "at some point"}. Changing it signs out every other browser.`
            : "You sign in by emailed link at the moment. A password means you can still get in when the mail doesn’t arrive."}
        </p>
        <PasswordForm hasPassword={password} />
      </div>

      {buildings.length > 0 ? (
        <div className="sheet mt-4 px-5 py-5">
          <h2 className="font-display text-brownstone text-xl">Your buildings</h2>
          <ul className="divide-limestone mt-2 divide-y">
            {buildings.map((building) => (
              <li key={building.id}>
                <Link
                  href={`/b/${building.slug}`}
                  className="hover:text-verdigris flex items-baseline justify-between gap-4 py-2.5"
                >
                  <span className="text-sm">{building.name}</span>
                  <span className="text-ironwork-faint font-mono text-xs">
                    {building.slug}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <form action={signOutAction} className="mt-6">
        <button
          type="submit"
          className="text-ironwork-soft hover:text-ironwork text-sm underline underline-offset-4"
        >
          Sign out
        </button>
      </form>
    </main>
  );
}
