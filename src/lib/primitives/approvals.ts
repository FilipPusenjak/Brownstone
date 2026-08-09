import type { Capability } from "~/lib/auth/capabilities";

/**
 * The approval lifecycle, as one state machine.
 *
 * Alterations, sublets and ticket responsibility determinations are the same
 * shape: someone asks, the board looks, an officer decides, and the decision is
 * recorded with a name on it. Encoding the transitions once means the third
 * module to use it cannot invent a fourth interpretation of "under review".
 *
 * Two properties this enforces that a set of booleans would not:
 *
 *   A decided request cannot be re-decided. Boards change their minds, and when
 *   they do the answer is a new request, not an edited record — otherwise the
 *   minutes and the system disagree about what was approved.
 *
 *   Only the person who filed a request may withdraw it, and only before a
 *   decision. Withdrawal after the fact would erase a denial.
 */

export type ApprovalStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "UNDER_REVIEW"
  | "APPROVED"
  | "APPROVED_WITH_CONDITIONS"
  | "DENIED"
  | "WITHDRAWN";

export type ApprovalAction =
  "submit" | "startReview" | "approve" | "approveWithConditions" | "deny" | "withdraw";

export const TERMINAL: readonly ApprovalStatus[] = [
  "APPROVED",
  "APPROVED_WITH_CONDITIONS",
  "DENIED",
  "WITHDRAWN",
];

export function isTerminal(status: ApprovalStatus): boolean {
  return TERMINAL.includes(status);
}

const TRANSITIONS: Record<
  ApprovalAction,
  {
    from: readonly ApprovalStatus[];
    to: ApprovalStatus;
    /** Who may do it: an officer capability, or the submitter. */
    actor: "submitter" | "decider";
  }
> = {
  submit: { from: ["DRAFT"], to: "SUBMITTED", actor: "submitter" },
  startReview: { from: ["SUBMITTED"], to: "UNDER_REVIEW", actor: "decider" },
  approve: { from: ["SUBMITTED", "UNDER_REVIEW"], to: "APPROVED", actor: "decider" },
  approveWithConditions: {
    from: ["SUBMITTED", "UNDER_REVIEW"],
    to: "APPROVED_WITH_CONDITIONS",
    actor: "decider",
  },
  deny: { from: ["SUBMITTED", "UNDER_REVIEW"], to: "DENIED", actor: "decider" },
  withdraw: {
    from: ["DRAFT", "SUBMITTED", "UNDER_REVIEW"],
    to: "WITHDRAWN",
    actor: "submitter",
  },
};

/** The capability required to decide each kind of request. */
export const DECIDE_CAPABILITY: Record<string, Capability> = {
  ALTERATION: "alteration.decide",
  SUBLET: "sublet.decide",
  TICKET_RESPONSIBILITY: "ticket.decideResponsibility",
};

export interface TransitionCheck {
  readonly status: ApprovalStatus;
  readonly action: ApprovalAction;
  /** Whether the actor filed this request. */
  readonly isSubmitter: boolean;
  /** Whether the actor holds the deciding capability for this kind. */
  readonly canDecide: boolean;
}

export type TransitionResult =
  | { readonly ok: true; readonly next: ApprovalStatus }
  | { readonly ok: false; readonly reason: string };

/**
 * Whether an action is allowed, and what it produces.
 *
 * The refusal reasons are written for the person reading the screen, because
 * they end up in the interface rather than a log.
 */
export function transition(check: TransitionCheck): TransitionResult {
  const rule = TRANSITIONS[check.action];

  if (!rule.from.includes(check.status)) {
    if (isTerminal(check.status)) {
      return {
        ok: false,
        reason:
          check.status === "WITHDRAWN"
            ? "This request was withdrawn. Start a new one to raise it again."
            : "This request has already been decided. Record a new request rather than changing this one — the decision is part of the building's record.",
      };
    }
    return {
      ok: false,
      reason: `A request that is ${humanise(check.status)} cannot be ${pastTense(check.action)}.`,
    };
  }

  if (rule.actor === "submitter" && !check.isSubmitter) {
    return {
      ok: false,
      reason: "Only the person who filed this request can withdraw it.",
    };
  }

  if (rule.actor === "decider" && !check.canDecide) {
    return {
      ok: false,
      reason: "You don't have permission to decide this request.",
    };
  }

  return { ok: true, next: rule.to };
}

/** Actions this actor could take right now — drives which buttons render. */
export function availableActions(
  check: Omit<TransitionCheck, "action">,
): ApprovalAction[] {
  return (Object.keys(TRANSITIONS) as ApprovalAction[]).filter(
    (action) => transition({ ...check, action }).ok,
  );
}

function humanise(status: ApprovalStatus): string {
  return status.toLowerCase().replaceAll("_", " ");
}

function pastTense(action: ApprovalAction): string {
  switch (action) {
    case "submit":
      return "submitted";
    case "startReview":
      return "moved into review";
    case "approve":
    case "approveWithConditions":
      return "approved";
    case "deny":
      return "denied";
    case "withdraw":
      return "withdrawn";
  }
}

/** Labels, in the words a board member would use on the button. */
export const ACTION_LABEL: Record<ApprovalAction, string> = {
  submit: "Submit to the board",
  startReview: "Start review",
  approve: "Approve",
  approveWithConditions: "Approve with conditions",
  deny: "Deny",
  withdraw: "Withdraw",
};
