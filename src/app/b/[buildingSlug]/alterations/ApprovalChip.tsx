import type { ApprovalStatus } from "~/lib/primitives/approvals";

/**
 * Approval status, in the four-state progression.
 *
 * This is the workflow that has all four: submitted is started (yellow), under
 * review is progress (blue), approved is complete (green), denied is the red of
 * a stamped notice. Draft and withdrawn carry no colour — nothing is being
 * asked of anyone.
 */
const STYLES: Record<ApprovalStatus, { label: string; className: string }> = {
  DRAFT: {
    label: "Draft",
    className: "border-limestone-deep text-ironwork-faint",
  },
  SUBMITTED: {
    label: "Waiting",
    className: "border-started-line bg-started-soft text-started",
  },
  UNDER_REVIEW: {
    label: "Under review",
    className: "border-progress-line bg-progress-soft text-progress",
  },
  APPROVED: {
    label: "Approved",
    className: "border-complete-line bg-complete-soft text-complete",
  },
  APPROVED_WITH_CONDITIONS: {
    label: "Approved, with conditions",
    className: "border-complete-line bg-complete-soft text-complete",
  },
  DENIED: {
    label: "Denied",
    className: "border-stamp bg-stamp-soft text-stamp",
  },
  WITHDRAWN: {
    label: "Withdrawn",
    className: "border-limestone text-ironwork-faint",
  },
};

export function ApprovalChip({ status }: { status: string }) {
  const style = STYLES[status as ApprovalStatus] ?? STYLES.DRAFT;

  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded-chip border px-1.5 py-0.5 font-mono text-[0.6875rem] uppercase tracking-wider ${style.className}`}
    >
      {status === "APPROVED" || status === "APPROVED_WITH_CONDITIONS" ? (
        <svg width="9" height="9" viewBox="0 0 10 10" aria-hidden fill="none">
          <path
            d="M1 5.2 3.6 8 9 2"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="square"
          />
        </svg>
      ) : null}
      {style.label}
    </span>
  );
}
