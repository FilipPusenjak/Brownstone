import Link from "next/link";
import type { BuildingContext } from "~/lib/db/context";
import type { Capability } from "~/lib/auth/capabilities";
import { can } from "~/lib/auth/capabilities";

/**
 * The shell: a bell plate on the left, the building's name across the top.
 *
 * Navigation is a column of mono labels on ironwork — the row of buttons beside
 * a brownstone's front door. Items the member has no capability for are not
 * rendered at all rather than disabled, because a greyed-out "Arrears" tells a
 * shareholder there is something they are not allowed to see, which is its own
 * small unkindness in a twelve-person building.
 */

interface NavItem {
  label: string;
  href: string;
  capability?: Capability;
  /** Scaffolded modules are marked so nobody mistakes a stub for a feature. */
  stub?: boolean;
}

const SECTIONS: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: "Building",
    items: [
      { label: "Overview", href: "" },
      { label: "Compliance", href: "/compliance", capability: "compliance.view" },
      { label: "Alterations", href: "/alterations" },
      { label: "Insurance", href: "/insurance", capability: "coi.view" },
      { label: "Documents", href: "/documents" },
    ],
  },
  {
    heading: "Records",
    items: [
      { label: "Units", href: "/units" },
      { label: "Members", href: "/members" },
      { label: "Audit trail", href: "/audit", capability: "audit.view" },
    ],
  },
  {
    heading: "Not yet built",
    items: [
      { label: "Notices", href: "/notices", capability: "notice.view", stub: true },
      { label: "Meetings", href: "/meetings", capability: "meeting.view", stub: true },
      { label: "Sublets", href: "/sublets", stub: true },
      { label: "Arrears", href: "/arrears", stub: true },
      { label: "Bookings", href: "/bookings", stub: true },
      { label: "Repairs", href: "/tickets", stub: true },
      { label: "Duty rotation", href: "/duty", capability: "duty.view", stub: true },
    ],
  },
];

export function AppShell({
  ctx,
  current,
  children,
}: {
  ctx: BuildingContext;
  current: string;
  children: React.ReactNode;
}) {
  const base = `/b/${ctx.building.slug}`;
  const houseNumber = ctx.building.addressLine1.split(" ")[0] ?? "";
  const rest = ctx.building.addressLine1.split(" ").slice(1).join(" ");

  return (
    <div className="min-h-dvh lg:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-paper focus:px-3 focus:py-2"
      >
        Skip to content
      </a>

      <nav
        aria-label="Building sections"
        className="shrink-0 bg-ironwork text-plaster lg:sticky lg:top-0 lg:h-dvh lg:w-56 lg:overflow-y-auto"
      >
        <div className="border-b border-white/12 px-4 py-4">
          <p className="font-mono text-[0.625rem] uppercase tracking-[0.18em] text-brass-soft">
            Co-operator
          </p>
          <p className="mt-2 font-display text-xl leading-tight text-plaster">
            {ctx.building.name}
          </p>
          <p className="mt-1 font-mono text-[0.6875rem] text-plaster/55">
            {houseNumber} {rest}
          </p>
        </div>

        <div className="px-2 py-3 max-lg:flex max-lg:flex-wrap max-lg:gap-x-4">
          {SECTIONS.map((section) => {
            const visible = section.items.filter(
              (item) => !item.capability || can(ctx, item.capability),
            );
            if (visible.length === 0) return null;

            return (
              <div key={section.heading} className="mb-4">
                <p className="px-2 pb-1.5 font-mono text-[0.625rem] uppercase tracking-[0.14em] text-plaster/40">
                  {section.heading}
                </p>
                <ul>
                  {visible.map((item) => {
                    const href = `${base}${item.href}`;
                    const active = current === item.href;

                    return (
                      <li key={item.href}>
                        <Link
                          href={href}
                          aria-current={active ? "page" : undefined}
                          className={`flex items-center justify-between gap-2 px-2 py-1.5 text-sm ${
                            active
                              ? "bg-verdigris text-white"
                              : "text-plaster/80 hover:bg-white/8 hover:text-plaster"
                          }`}
                        >
                          <span>{item.label}</span>
                          {item.stub ? (
                            <span className="font-mono text-[0.5625rem] uppercase tracking-wider text-plaster/35">
                              stub
                            </span>
                          ) : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>

        <div className="border-t border-white/12 px-4 py-3">
          <p className="text-sm text-plaster/90">{ctx.user.name ?? ctx.user.email}</p>
          <p className="mt-0.5 font-mono text-[0.6875rem] text-plaster/50">
            {ctx.membership.title ?? titleFromRoles(ctx)}
          </p>
        </div>
      </nav>

      <div className="min-w-0 flex-1">
        <main id="main" className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-10">
          {children}
        </main>
        <Disclaimer />
      </div>
    </div>
  );
}

function titleFromRoles(ctx: BuildingContext): string {
  return ctx.membership.roles
    .map((role) => role.charAt(0) + role.slice(1).toLowerCase().replace("_", " "))
    .join(" · ");
}

/**
 * Persistent, on every page, never dismissible. A product that tracks legal
 * deadlines has to be plain about what it is not.
 */
function Disclaimer() {
  return (
    <footer className="mx-auto max-w-5xl border-t border-limestone px-4 py-5 sm:px-6 lg:px-10">
      <p className="max-w-3xl text-xs leading-relaxed text-ironwork-faint">
        Co-operator is a tracking tool, not legal advice. Requirements and filing
        dates change, and some of what is listed here is marked unverified for
        that reason. The board remains responsible for the building&rsquo;s
        filings.
      </p>
    </footer>
  );
}
