/**
 * The header every module page uses.
 *
 * The eyebrow names the authority or the section in mono — the register of a
 * filing header — and the title is set in the UI face, not the display face.
 * Display is reserved for building names and house numbers, and spending it on
 * page titles would make the whole product shout.
 */
export function PageHeader({
  eyebrow,
  title,
  lede,
  actions,
}: {
  eyebrow?: React.ReactNode;
  title: string;
  lede?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="border-limestone mb-6 flex flex-wrap items-end justify-between gap-4 border-b pb-4">
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
        <h1 className="text-ironwork text-2xl font-semibold tracking-tight">{title}</h1>
        {lede ? (
          <p className="text-ironwork-soft mt-1.5 max-w-2xl text-sm">{lede}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 gap-2">{actions}</div> : null}
    </header>
  );
}

/**
 * An empty screen is an invitation to act, so it always says what to do next
 * rather than reporting that a list is empty.
 */
export function EmptyState({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="sheet px-6 py-10 text-center">
      <p className="text-ironwork text-sm font-medium">{title}</p>
      {children ? (
        <div className="text-ironwork-soft mx-auto mt-2 max-w-md text-sm">
          {children}
        </div>
      ) : null}
    </div>
  );
}
