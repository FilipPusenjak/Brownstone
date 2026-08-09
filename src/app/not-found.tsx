import Link from "next/link";

/**
 * Not found.
 *
 * This page carries more weight than a 404 usually does: a building you are not
 * a member of returns 404 rather than 403, deliberately, so that a stranger
 * cannot confirm a co-op exists at a given slug by reading the status code. The
 * wording has to cover both cases — "no such page" and "not yours" — without
 * telling the reader which one they hit.
 */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-6 py-16">
      <div className="sheet px-6 py-7">
        <p className="eyebrow">Co-operator</p>
        <h1 className="mt-2 font-display text-3xl leading-tight text-brownstone">
          Nothing here
        </h1>
        <p className="mt-4 text-sm text-ironwork-soft">
          Either this page doesn&rsquo;t exist, or it belongs to a building you
          aren&rsquo;t a member of. If a neighbour sent you the link, ask them to
          invite you — an invitation goes to your email address and only works
          for it.
        </p>
        <p className="mt-5 text-sm">
          <Link href="/" className="text-verdigris underline underline-offset-4">
            Back to your building
          </Link>
        </p>
      </div>
      <p className="mt-6 text-xs leading-relaxed text-ironwork-faint">
        Co-operator is a tracking tool, not legal advice. The board remains
        responsible for the building&rsquo;s filings.
      </p>
    </main>
  );
}
