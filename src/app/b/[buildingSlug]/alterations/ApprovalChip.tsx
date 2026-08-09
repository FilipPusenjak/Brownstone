import type { ApprovalStatus } from "~/lib/primitives/approvals";

/**
 * Approval status, in the same two colours as everything else.
 *
 * Verdigris means someone needs to act; stamp red means denied. Approved is
 * deliberately colourless — ink and a mark, like a stamped permit. A green
 * "approved" chip would make the palette carry three signals and none of them
 * would be loud.
 */
const STYLES: Record<ApprovalStatus, { label: string; className: string }> = {
  DRAFT: {
    label: "Draft",
    className: "border-limestone-deep text-ironwork-faint",
  },
  SUBMITTED: {
    label: "Waiting",
    className: "border-verdigris bg-verdigris-soft text-verdigris",
  },
  UNDER_REVIEW: {
    label: "Under review",
    className: "border-verdigris bg-verdigris-soft text-verdigris",
  },
  APPROVED: {
    label: "Approved",
    className: "border-limestone text-ironwork-soft",
  },
  APPROVED_WITH_CONDITIONS: {
    label: "Approved, with conditions",
    className: "border-limestone-deep text-ironwork",
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
