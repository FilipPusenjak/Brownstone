import type { DueStatus } from "~/lib/primitives/obligations/recurrence";

/**
 * Status, in the four-state progression: started is yellow, in progress is
 * blue, complete is green, overdue is the red of a stamped notice.
 *
 * The compliance calendar has no "in progress" of its own — a filing is due or
 * it is made — so blue appears on approval workflows rather than here. Upcoming
 * carries no colour at all, because nothing is being asked of anyone yet, and a
 * calendar where every row is coloured is a calendar where colour means
 * nothing.
 */
const STYLES: Record<DueStatus, { label: string; className: string }> = {
  OVERDUE: {
    label: "Overdue",
    className: "bg-stamp-soft text-stamp border-stamp",
  },
  DUE_SOON: {
    label: "Due soon",
    className: "bg-started-soft text-started border-started-line",
  },
  UPCOMING: {
    label: "Upcoming",
    className: "bg-transparent text-ironwork-soft border-limestone-deep",
  },
  COMPLETED: {
    label: "Complete",
    className: "bg-complete-soft text-complete border-complete-line",
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
      className={`rounded-chip inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 font-mono text-[0.6875rem] tracking-wider uppercase ${style.className}`}
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
      className="rounded-chip border-brass text-brass inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 font-mono text-[0.6875rem] tracking-wider uppercase"
    >
      Unverified
    </span>
  );
}
