"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * The navigation list, split out as a client component so the active item comes
 * from the actual URL.
 *
 * The alternative — every page passing its own `current` string — was in place
 * briefly and was wrong on every page but one, because nothing forces a page to
 * remember. Deriving it from the pathname cannot drift.
 */

export interface NavLink {
  readonly label: string;
  readonly href: string;
  readonly stub?: boolean;
}

export function NavLinks({ base, items }: { base: string; items: readonly NavLink[] }) {
  const pathname = usePathname();

  return (
    <ul>
      {items.map((item) => {
        const href = `${base}${item.href}`;
        // Exact match for the overview; prefix match elsewhere so an obligation
        // detail page keeps Compliance lit. Longer siblings win, so
        // /compliance/rules highlights Requirements rather than Compliance.
        const active =
          item.href === ""
            ? pathname === base || pathname === `${base}/`
            : pathname === href ||
              (pathname.startsWith(`${href}/`) &&
                !items.some(
                  (other) =>
                    other.href.length > item.href.length &&
                    pathname.startsWith(`${base}${other.href}`),
                ));

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
  );
}
