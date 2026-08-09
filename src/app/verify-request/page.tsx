import Link from "next/link";

/**
 * "Check your email."
 *
 * Auth.js sends people here after they ask for a link, and it is the only thing
 * between a person and giving up on signing in. So it says what to expect, how
 * long the link lasts, and what to do when it doesn't arrive — the three
 * questions someone standing in a hallway with their phone actually has.
 *
 * It deliberately does not say whether the address belongs to a member. A page
 * that said "we don't know that address" would let anyone check who is in the
 * building, one guess at a time.
 */
export default function VerifyRequestPage() {
  const catching = process.env["EMAIL_DRIVER"] !== "resend";

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="sheet px-6 py-7">
        <p className="eyebrow">Co-operator</p>
        <h1 className="mt-2 font-display text-3xl leading-tight text-brownstone">
          Check your email
        </h1>
        <p className="mt-4 text-sm text-ironwork-soft">
          If that address belongs to a member of a building here, a sign-in link
          is on its way. It works once, and it expires in fifteen minutes.
        </p>
        <p className="mt-3 text-sm text-ironwork-soft">
          Nothing yet? Look in spam, then{" "}
          <Link href="/sign-in" className="text-verdigris underline underline-offset-4">
            ask for another
          </Link>
          . If it still doesn&rsquo;t arrive, a board member can check the
          address they have for you.
        </p>

        {catching ? (
          <p className="mt-5 border-l-2 border-limestone-deep bg-paper-sunk px-3 py-2 font-mono text-xs text-ironwork-soft">
            This installation is running the development mail catcher: nothing
            was sent. The link is in <span className="text-ironwork">./.mail</span>.
          </p>
        ) : null}
      </div>
      <p className="mt-6 text-xs leading-relaxed text-ironwork-faint">
        Co-operator is a tracking tool, not legal advice. The board remains
        responsible for the building&rsquo;s filings.
      </p>
    </main>
  );
}
