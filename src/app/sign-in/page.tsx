import { signIn } from "~/lib/auth/config";

/**
 * Sign in.
 *
 * One field. A three-person board in a twelve-unit brownstone will not set up
 * an OAuth app, and asking them to choose a password produces one shared
 * password taped inside the boiler room door.
 */
export default function SignInPage() {
  async function requestLink(formData: FormData): Promise<void> {
    "use server";
    const email = String(formData.get("email") ?? "").trim();
    if (!email) return;
    await signIn("email", { email, redirectTo: "/" });
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="sheet px-6 py-7">
        <p className="eyebrow">Co-operator</p>
        <h1 className="mt-2 font-display text-3xl leading-tight text-brownstone">
          Sign in
        </h1>
        <p className="mt-3 text-sm text-ironwork-soft">
          We&rsquo;ll email you a link. No password to remember, and nothing to
          set up.
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
