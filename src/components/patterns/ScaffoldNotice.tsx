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
    <aside className="mb-6 border-l-2 border-brass bg-paper px-4 py-3">
      <p className="text-sm font-medium text-ironwork">
        This module reads, but doesn&rsquo;t write yet.
      </p>
      <p className="mt-1 text-sm text-ironwork-soft">
        What&rsquo;s below is real data from this building. Still to build:
      </p>
      <ul className="mt-2 space-y-0.5">
        {missing.map((item) => (
          <li key={item} className="font-mono text-[0.6875rem] text-ironwork-faint">
            — {item}
          </li>
        ))}
      </ul>
    </aside>
  );
}
