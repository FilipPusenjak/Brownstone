import { beforeAll, describe, expect, it } from "vitest";
import { CapabilityError } from "~/lib/auth/capabilities";
import type { BuildingContext } from "~/lib/db/context";
import { listAssessments, listObligations } from "~/lib/db/scoped/compliance";
import {
  assignObligation,
  completeObligation,
  confirmAssessment,
  dismissAssessment,
  reassessBuilding,
  reopenObligation,
  waiveObligation,
} from "~/lib/db/scoped/compliance-writes";
import { listAudit } from "~/lib/db/scoped/audit";
import { addDays, today, toPlainDate } from "~/lib/time";
import { ADELAIDE, PEOPLE, contextFor } from "../helpers/context";

/**
 * The compliance calendar, end to end, against the real database.
 *
 * These exercise the path a board actually walks: a proposal is reviewed, a
 * filing is recorded, the next occurrence appears. The properties worth
 * protecting are the ones a board would never notice breaking until a deadline
 * passed — a recurring obligation that quietly stops recurring, or a completion
 * that leaves stale reminders behind to nag about a filing already made.
 *
 * Note for anyone adding to this file: it mutates the seeded building rather
 * than working against a fixture, because the point is to exercise the real
 * scoped write path under row-level security. Tests here must therefore never
 * assert on absolute row counts, and the tenancy suite must not either — it
 * asserts on which building a row belongs to, which no amount of writing here
 * can change.
 */

describe("compliance lifecycle", () => {
  let president: BuildingContext;
  let shareholder: BuildingContext;
  let now: string;

  beforeAll(async () => {
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    shareholder = await contextFor(PEOPLE.halShareholder, ADELAIDE);
    now = today(president.building.timezone);
  });

  describe("the review queue", () => {
    it("proposes rules without putting them on the calendar", async () => {
      const proposed = await listAssessments(president, { decision: "PROPOSED" });
      const obligations = await listObligations(president);

      expect(proposed.length).toBeGreaterThan(0);
      const onCalendar = new Set(obligations.map((o) => o.ruleCode));
      for (const assessment of proposed) {
        expect(onCalendar.has(assessment.ruleCode)).toBe(false);
      }
    });

    it("confirming adds it to the calendar with reminders", async () => {
      const result = await confirmAssessment(president, {
        ruleCode: "hpd-indoor-allergen-inspection",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const obligations = await listObligations(president);
      const created = obligations.find((o) => o.id === result.data.obligationId);
      expect(created?.ruleCode).toEqual("hpd-indoor-allergen-inspection");
      expect(created?.state).toEqual("OPEN");

      const confirmed = await listAssessments(president, { decision: "CONFIRMED" });
      expect(confirmed.map((a) => a.ruleCode)).toContain(
        "hpd-indoor-allergen-inspection",
      );
    });

    it("refuses to confirm the same rule twice", async () => {
      const again = await confirmAssessment(president, {
        ruleCode: "hpd-indoor-allergen-inspection",
      });
      expect(again.ok).toBe(false);
      if (!again.ok) expect(again.code).toEqual("conflict");
    });

    it("asks for a date rather than inventing one", async () => {
      // The gas piping cycle depends on a community district schedule the
      // engine has no way to know. It must ask, not guess: a confidently wrong
      // deadline is worse than an absent one, because a board will plan around
      // it.
      const result = await confirmAssessment(president, {
        ruleCode: "dep-ll152-gas-piping",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("invalid");
      expect(result.message).toMatch(/city assigns/i);
      expect(result.fields?.["dueOn"]).toBeDefined();
    });

    it("accepts the date when the board supplies it", async () => {
      const result = await confirmAssessment(president, {
        ruleCode: "dep-ll152-gas-piping",
        dueOn: "2027-06-30",
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const obligations = await listObligations(president);
      const created = obligations.find((o) => o.id === result.data.obligationId);
      expect(created && toPlainDate(created.dueOn)).toEqual("2027-06-30");
    });

    it("rejects a malformed date instead of storing something odd", async () => {
      const result = await confirmAssessment(president, {
        ruleCode: "hpd-stove-knob-covers",
        dueOn: "next Tuesday",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields?.["dueOn"]).toBeDefined();
    });

    it("will not dismiss a rule without a reason", async () => {
      const result = await dismissAssessment(president, {
        ruleCode: "hpd-stove-knob-covers",
        note: "no",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields?.["note"]).toBeDefined();
    });

    it("keeps the reason a rule was dismissed", async () => {
      const note = "Building went all-electric in 2019. No gas stoves anywhere.";
      const result = await dismissAssessment(president, {
        ruleCode: "hpd-stove-knob-covers",
        note,
      });
      expect(result.ok).toBe(true);

      const dismissed = await listAssessments(president, { decision: "DISMISSED" });
      const row = dismissed.find((a) => a.ruleCode === "hpd-stove-knob-covers");

      // The whole point: a name and a date on the decision, for the board that
      // inherits it.
      expect(row?.decisionNote).toEqual(note);
      expect(row?.decidedAt).toBeTruthy();
      expect(row?.decidedBy?.user.email).toEqual(PEOPLE.noraPresident);
    });
  });

  describe("recording a filing", () => {
    it("marks it filed and generates the next occurrence", async () => {
      const before = await listObligations(president, { state: "OPEN" });
      const registration = before.find(
        (o) => o.ruleCode === "hpd-property-registration",
      );
      expect(registration).toBeDefined();
      if (!registration) return;

      const result = await completeObligation(president, {
        obligationId: registration.id,
        note: "Filed online. Confirmation 4471902.",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      // A recurring obligation that silently stops recurring is the worst
      // failure available here: the calendar looks healthy right up until the
      // deadline passes unnoticed.
      expect(result.data.nextObligationId).not.toBeNull();
      expect(result.data.nextDueOn).toBeTruthy();

      const after = await listObligations(president);
      const closed = after.find((o) => o.id === registration.id);
      expect(closed?.state).toEqual("COMPLETED");
      expect(closed?.completionNote).toContain("4471902");

      const next = after.find((o) => o.id === result.data.nextObligationId);
      expect(next?.state).toEqual("OPEN");
      expect(next && toPlainDate(next.dueOn)).toEqual(result.data.nextDueOn);
    });

    it("chains the new occurrence to the one it replaces", async () => {
      const obligations = await listObligations(president);
      const chained = obligations.filter(
        (o) => o.ruleCode === "hpd-property-registration",
      );
      expect(chained.length).toBeGreaterThanOrEqual(2);
    });

    it("clears reminders that would nag about a filing already made", async () => {
      const obligations = await listObligations(president);
      const closed = obligations.find(
        (o) => o.ruleCode === "hpd-property-registration" && o.state === "COMPLETED",
      );
      expect(closed).toBeDefined();
      if (!closed) return;

      const { listReminders } = await import("~/lib/db/scoped/compliance");
      const reminders = await listReminders(president);
      const stale = reminders.filter(
        (r) => r.obligationId === closed.id && !r.sentAt,
      );
      expect(stale).toEqual([]);
    });

    it("refuses a completion date in the future", async () => {
      const open = await listObligations(president, { state: "OPEN" });
      const target = open[0];
      expect(target).toBeDefined();
      if (!target) return;

      const result = await completeObligation(president, {
        obligationId: target.id,
        completedOn: addDays(now as never, 3),
      });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.fields?.["completedOn"]).toBeDefined();
    });

    it("refuses to close something already closed", async () => {
      const obligations = await listObligations(president);
      const closed = obligations.find((o) => o.state === "COMPLETED");
      expect(closed).toBeDefined();
      if (!closed) return;

      const result = await completeObligation(president, { obligationId: closed.id });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toEqual("conflict");
    });
  });

  describe("taking something off the calendar", () => {
    it("records a waiver separately from a filing", async () => {
      const open = await listObligations(president, { state: "OPEN" });
      const target = open.find((o) => o.ruleCode === "dep-ll152-gas-piping");
      expect(target).toBeDefined();
      if (!target) return;

      const reason = "Confirmed with the plumber that our district files in 2028.";
      const result = await waiveObligation(president, {
        obligationId: target.id,
        reason,
        notApplicable: true,
      });
      expect(result.ok).toBe(true);

      const after = await listObligations(president);
      const waived = after.find((o) => o.id === target.id);

      // Never COMPLETED: "we don't have to do this" and "we did this" are
      // different facts, and a record that conflates them claims a filing that
      // never happened.
      expect(waived?.state).toEqual("NOT_APPLICABLE");
      expect(waived?.completedOn).toBeNull();
    });

    it("will not waive without a reason", async () => {
      const open = await listObligations(president, { state: "OPEN" });
      const target = open[0];
      if (!target) return;

      const result = await waiveObligation(president, {
        obligationId: target.id,
        reason: "nope",
      });
      expect(result.ok).toBe(false);
    });

    it("can be reopened when it comes off by mistake", async () => {
      const obligations = await listObligations(president);
      const waived = obligations.find((o) => o.state === "NOT_APPLICABLE");
      expect(waived).toBeDefined();
      if (!waived) return;

      const result = await reopenObligation(president, { obligationId: waived.id });
      expect(result.ok).toBe(true);

      const after = await listObligations(president);
      expect(after.find((o) => o.id === waived.id)?.state).toEqual("OPEN");
    });
  });

  describe("assignment", () => {
    it("puts a name against a filing", async () => {
      const open = await listObligations(president, { state: "OPEN" });
      const target = open[0];
      if (!target) return;

      const result = await assignObligation(president, {
        obligationId: target.id,
        membershipId: shareholder.membership.id,
      });
      expect(result.ok).toBe(true);

      const after = await listObligations(president);
      expect(after.find((o) => o.id === target.id)?.assignee?.id).toEqual(
        shareholder.membership.id,
      );
    });

    it("refuses a membership from another building", async () => {
      const { LISPENARD } = await import("../helpers/context");
      const other = await contextFor(PEOPLE.ivanPresident, LISPENARD);
      const open = await listObligations(president, { state: "OPEN" });
      const target = open[0];
      if (!target) return;

      const result = await assignObligation(president, {
        obligationId: target.id,
        membershipId: other.membership.id,
      });

      // Row-level security confines the lookup to this building, so a
      // membership id from elsewhere is simply not found.
      expect(result.ok).toBe(false);
    });
  });

  describe("permissions", () => {
    it("does not let a shareholder confirm what applies", async () => {
      await expect(
        confirmAssessment(shareholder, { ruleCode: "dohmh-smoke-co-annual-notice" }),
      ).rejects.toThrow(CapabilityError);
    });

    it("does not let a shareholder record a filing", async () => {
      const open = await listObligations(president, { state: "OPEN" });
      const target = open[0];
      if (!target) return;

      await expect(
        completeObligation(shareholder, { obligationId: target.id }),
      ).rejects.toThrow(CapabilityError);
    });

    it("still lets a shareholder read the calendar", async () => {
      // Building-wide by design. Hiding the list from the people who live there
      // would recreate the problem the product exists to solve.
      const obligations = await listObligations(shareholder);
      expect(obligations.length).toBeGreaterThan(0);
    });
  });

  describe("re-running the engine", () => {
    it("is idempotent and leaves decided rules alone", async () => {
      const before = await listAssessments(president);
      const result = await reassessBuilding(president);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.created).toEqual(0);

      const after = await listAssessments(president);
      expect(after.length).toEqual(before.length);

      const decidedBefore = before.filter((a) => a.decision !== "PROPOSED");
      const decidedAfter = after.filter((a) => a.decision !== "PROPOSED");
      expect(decidedAfter.length).toEqual(decidedBefore.length);
    });
  });

  describe("the audit trail", () => {
    it("records who did what, so the next board can reconstruct it", async () => {
      const entries = await listAudit(president, { limit: 200 });
      const actions = new Set(entries.map((e) => e.action));

      expect(actions.has("compliance.confirm")).toBe(true);
      expect(actions.has("compliance.dismiss")).toBe(true);
      expect(actions.has("compliance.markComplete")).toBe(true);
      expect(actions.has("compliance.waive")).toBe(true);

      for (const entry of entries) {
        expect(entry.buildingId).toEqual(president.building.id);
      }

      const completion = entries.find((e) => e.action === "compliance.markComplete");
      expect(completion?.actorMembership?.user.email).toEqual(PEOPLE.noraPresident);
    });

    it("keeps the audit trail out of a shareholder's reach", async () => {
      await expect(listAudit(shareholder)).rejects.toThrow(CapabilityError);
    });
  });
});
