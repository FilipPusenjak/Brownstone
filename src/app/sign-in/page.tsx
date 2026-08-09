import { signIn } from "~/lib/auth/config";

/**
 * Sign in.
 *
 * One field. A three-person board in a twelve-unit brownstone will not set up
 * an OAuth app, and asking them to choose a password produces one shared
 * password taped inside the boiler room door.
 */

/**
 * An invitation token carried through sign-in.
 *
 * The token is minted as base64url, so anything outside that alphabet did not
 * come from us and is dropped. This is the only user-supplied value that ends
 * up in a redirect target, and a token that is echoed back unchecked is how a
 * sign-in page becomes an open redirect.
 */
function safeInviteToken(value: string | undefined): string | null {
  if (!value) return null;
  return /^[A-Za-z0-9_-]{20,200}$/.test(value) ? value : null;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ invite?: string }>;
}) {
  const { invite } = await searchParams;
  const token = safeInviteToken(invite);

  async function requestLink(formData: FormData): Promise<void> {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    if (!email) return;
    // Land back on the invitation rather than the building list, which the
    // invited person is not yet a member of.
    await signIn("email", { email, redirectTo: token ? `/invite/${token}` : "/" });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="sheet px-6 py-7">
        <p className="eyebrow">Co-operator</p>
        <h1 className="mt-2 font-display text-3xl leading-tight text-brownstone">
          Sign in
        </h1>
        <p className="mt-3 text-sm text-ironwork-soft">
          {token
            ? "Use the address your invitation was sent to — it only works for that one. We’ll email you a link, and you’ll come straight back here."
            : "We’ll email you a link. No password to remember, and nothing to set up."}
        </p>

        <form action={requestLink} className="mt-6">
          <label
            htmlFor="email"
            className="eyebrow mb-1.5 block"
          >
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full rounded-sheet border border-limestone-deep bg-white px-3 py-2.5 font-mono text-sm text-ironwork placeholder:text-ironwork-faint"
            placeholder="you@example.com"
          />
          <button
            type="submit"
            className="mt-4 w-full rounded-sheet bg-verdigris px-4 py-2.5 text-sm font-semibold text-white hover:bg-verdigris/90"
          >
            Email me a link
          </button>
        </form>
      </div>

      <p className="mt-6 text-xs leading-relaxed text-ironwork-faint">
        Co-operator is a tracking tool, not legal advice. The board remains
        responsible for the building&rsquo;s filings.
      </p>
    </main>
  );
}
