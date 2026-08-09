import type { DueStatus } from "~/lib/primitives/obligations/recurrence";

/**
 * Status, in the two saturated colours and no others.
 *
 * Completed is deliberately colourless — ink on paper, the way a stamped permit
 * is just ink. If success were green, the palette would carry three signals and
 * none of them would be loud.
 */

const STYLES: Record<DueStatus, { label: string; className: string }> = {
  OVERDUE: {
    label: "Overdue",
    className: "bg-stamp-soft text-stamp border-stamp",
  },
  DUE_SOON: {
    label: "Due soon",
    className: "bg-verdigris-soft text-verdigris border-verdigris",
  },
  UPCOMING: {
    label: "Upcoming",
    className: "bg-transparent text-ironwork-soft border-limestone-deep",
  },
  COMPLETED: {
    label: "Complete",
    className: "bg-transparent text-ironwork-faint border-limestone",
  },
  WAIVED: {
    label: "Waived",
    className: "bg-transparent text-ironwork-faint border-limestone",
  },
  NOT_APPLICABLE: {
    label: "Not applicable",
    className: "bg-transparent text-ironwork-faint border-limestone",
  },
};

export function StatusChip({ status }: { status: DueStatus }) {
  const style = STYLES[status];

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-chip border px-1.5 py-0.5 font-mono text-[0.6875rem] uppercase tracking-wider ${style.className}`}
    >
      {status === "COMPLETED" ? <CheckMark /> : null}
      {style.label}
    </span>
  );
}

function CheckMark() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden fill="none">
      <path
        d="M1 5.2 3.6 8 9 2"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="square"
      />
    </svg>
  );
}

/**
 * A rule whose deadline or exemption boundary could not be confirmed to a
 * citation. Shown wherever the obligation is, never hidden — a board is better
 * served by "we think this applies, check the date" than by a confident wrong
 * date or by silence.
 */
export function UnverifiedChip({ title }: { title?: string }) {
  return (
    <span
      title={title ?? "Some detail of this requirement could not be verified."}
      className="inline-flex shrink-0 items-center gap-1 rounded-chip border border-brass px-1.5 py-0.5 font-mono text-[0.6875rem] uppercase tracking-wider text-brass"
    >
      Unverified
    </span>
  );
}
