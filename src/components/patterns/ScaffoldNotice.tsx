/**
 * The banner every scaffolded module carries.
 *
 * Each of these seven modules has real tables, real scoped queries and a list
 * view showing real seeded data — and nothing that writes. Saying so on the
 * page matters: a board member who files a repair ticket into a screen that
 * quietly discards it is worse off than one who was told to phone the super.
 *
 * The list of what is missing is the same list as the module's TODO.md, so the
 * page and the repository agree.
 */
export function ScaffoldNotice({ missing }: { missing: readonly string[] }) {
  return (
    <aside className="border-brass bg-paper mb-6 border-l-2 px-4 py-3">
      <p className="text-ironwork text-sm font-medium">
        This module reads, but doesn&rsquo;t write yet.
      </p>
      <p className="text-ironwork-soft mt-1 text-sm">
        What&rsquo;s below is real data from this building. Still to build:
      </p>
      <ul className="mt-2 space-y-0.5">
        {missing.map((item) => (
          <li key={item} className="text-ironwork-faint font-mono text-[0.6875rem]">
            — {item}
          </li>
        ))}
      </ul>
    </aside>
  );
}
