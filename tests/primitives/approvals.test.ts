import { describe, expect, it } from "vitest";
import {
  availableActions,
  isTerminal,
  transition,
  type ApprovalStatus,
} from "~/lib/primitives/approvals";

const submitter = { isSubmitter: true, canDecide: false };
const officer = { isSubmitter: false, canDecide: true };
const bystander = { isSubmitter: false, canDecide: false };

describe("approval transitions", () => {
  it("walks the ordinary path", () => {
    expect(transition({ status: "DRAFT", action: "submit", ...submitter })).toEqual({
      ok: true,
      next: "SUBMITTED",
    });
    expect(
      transition({ status: "SUBMITTED", action: "startReview", ...officer }),
    ).toEqual({
      ok: true,
      next: "UNDER_REVIEW",
    });
    expect(
      transition({ status: "UNDER_REVIEW", action: "approve", ...officer }),
    ).toEqual({
      ok: true,
      next: "APPROVED",
    });
  });

  it("lets a board decide straight from submitted", () => {
    // A three-person board that meets in the hallway does not always click
    // "start review" first.
    expect(transition({ status: "SUBMITTED", action: "approve", ...officer }).ok).toBe(
      true,
    );
    expect(transition({ status: "SUBMITTED", action: "deny", ...officer }).ok).toBe(
      true,
    );
  });

  it("supports approval with conditions", () => {
    expect(
      transition({
        status: "UNDER_REVIEW",
        action: "approveWithConditions",
        ...officer,
      }),
    ).toEqual({ ok: true, next: "APPROVED_WITH_CONDITIONS" });
  });

  describe("decided requests are final", () => {
    const decided: ApprovalStatus[] = [
      "APPROVED",
      "APPROVED_WITH_CONDITIONS",
      "DENIED",
    ];

    it.each(decided)("%s cannot be decided again", (status) => {
      const result = transition({ status, action: "approve", ...officer });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/already been decided/i);
    });

    it.each(decided)("%s cannot be withdrawn after the fact", (status) => {
      // Withdrawal after a decision would erase a denial from the record.
      expect(transition({ status, action: "withdraw", ...submitter }).ok).toBe(false);
    });

    it("a denial cannot be quietly flipped to an approval", () => {
      expect(transition({ status: "DENIED", action: "approve", ...officer }).ok).toBe(
        false,
      );
    });
  });

  describe("who may act", () => {
    it("lets only the submitter withdraw", () => {
      expect(
        transition({ status: "SUBMITTED", action: "withdraw", ...submitter }).ok,
      ).toBe(true);

      const byOfficer = transition({
        status: "SUBMITTED",
        action: "withdraw",
        ...officer,
      });
      expect(byOfficer.ok).toBe(false);
      if (!byOfficer.ok) expect(byOfficer.reason).toMatch(/person who filed/i);
    });

    it("refuses a decision from someone without the capability", () => {
      const result = transition({
        status: "SUBMITTED",
        action: "approve",
        ...submitter,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/permission/i);
    });

    it("gives a bystander nothing to do", () => {
      expect(availableActions({ status: "SUBMITTED", ...bystander })).toEqual([]);
    });

    it("does not let a shareholder approve their own request", () => {
      // The submitter flag must never imply the deciding capability, or every
      // shareholder approves their own renovation.
      expect(
        transition({
          status: "SUBMITTED",
          action: "approve",
          isSubmitter: true,
          canDecide: false,
        }).ok,
      ).toBe(false);
    });

    it("does let an officer who filed it decide it", () => {
      // In a twelve-unit co-op the treasurer renovates their own kitchen. That
      // is a governance question for the board's minutes, not something the
      // state machine can resolve, so it is permitted and recorded.
      expect(
        transition({
          status: "SUBMITTED",
          action: "approve",
          isSubmitter: true,
          canDecide: true,
        }).ok,
      ).toBe(true);
    });
  });

  describe("withdrawn requests", () => {
    it("say to start a new one", () => {
      const result = transition({
        status: "WITHDRAWN",
        action: "submit",
        ...submitter,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/withdrawn/i);
    });
  });

  it("marks exactly the four end states as terminal", () => {
    expect(isTerminal("APPROVED")).toBe(true);
    expect(isTerminal("APPROVED_WITH_CONDITIONS")).toBe(true);
    expect(isTerminal("DENIED")).toBe(true);
    expect(isTerminal("WITHDRAWN")).toBe(true);
    expect(isTerminal("DRAFT")).toBe(false);
    expect(isTerminal("SUBMITTED")).toBe(false);
    expect(isTerminal("UNDER_REVIEW")).toBe(false);
  });

  it("offers no action at all on a terminal request", () => {
    for (const status of ["APPROVED", "DENIED", "WITHDRAWN"] as ApprovalStatus[]) {
      expect(availableActions({ status, isSubmitter: true, canDecide: true })).toEqual(
        [],
      );
    }
  });
});

describe("availableActions", () => {
  it("gives the submitter submit and withdraw on a draft", () => {
    expect(availableActions({ status: "DRAFT", ...submitter }).sort()).toEqual(
      ["submit", "withdraw"].sort(),
    );
  });

  it("gives an officer the three decisions plus review", () => {
    expect(availableActions({ status: "SUBMITTED", ...officer }).sort()).toEqual(
      ["approve", "approveWithConditions", "deny", "startReview"].sort(),
    );
  });

  it("agrees with transition for every action it returns", () => {
    const statuses: ApprovalStatus[] = [
      "DRAFT",
      "SUBMITTED",
      "UNDER_REVIEW",
      "APPROVED",
      "DENIED",
      "WITHDRAWN",
    ];

    for (const status of statuses) {
      for (const actor of [submitter, officer, bystander]) {
        for (const action of availableActions({ status, ...actor })) {
          expect(transition({ status, action, ...actor }).ok).toBe(true);
        }
      }
    }
  });
});
