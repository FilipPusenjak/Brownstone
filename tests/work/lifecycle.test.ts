import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { CapabilityError } from "~/lib/auth/capabilities";
import { splitLines } from "~/components/patterns/ShareSplit";
import type { BuildingContext } from "~/lib/db/context";
import { unitLedger } from "~/lib/db/scoped/ledger";
import { listUnitsWithShares } from "~/lib/db/scoped/units";
import { assessmentCharges, getWork, listWork } from "~/lib/db/scoped/work";
import {
  createWork,
  raiseAssessment,
  recordDecision,
  updateWork,
} from "~/lib/db/scoped/work-writes";
import { makeDate, type PlainDate } from "~/lib/time";
import { ADELAIDE, LISPENARD, PEOPLE, contextFor } from "../helpers/context";

/**
 * Building work and the assessments that pay for it.
 *
 * The thing under test is the promise the interface makes to a shareholder: the
 * percentage shown against your apartment is the percentage you are charged,
 * and the parts add up to what the building said the job would cost. A rounding
 * error here is a neighbour who can prove the numbers don't add up, at a
 * meeting, in front of everyone.
 */

/** A due date the seed never uses, unique per call so runs don't collide. */
function freshDueDate(): PlainDate {
  const month = (Math.floor(Math.random() * 12) + 1) as number;
  const day = (Math.floor(Math.random() * 28) + 1) as number;
  return makeDate(2029, month, day);
}

/** The board votes it through. Required before any assessment can be raised. */
async function approve(ctx: BuildingContext, workId: string): Promise<void> {
  const result = await recordDecision(ctx, workId, {
    decidedOn: makeDate(2028, 3, 14),
    votesFor: 4,
    votesAgainst: 1,
  });
  if (!result.ok) throw new Error(`could not record the decision: ${result.message}`);
}

describe("building work", () => {
  let treasurer: BuildingContext;
  let president: BuildingContext;
  let shareholder: BuildingContext;
  let otherBuilding: BuildingContext;

  beforeAll(async () => {
    treasurer = await contextFor(PEOPLE.desmondTreasurer, ADELAIDE);
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    shareholder = await contextFor(PEOPLE.halShareholder, ADELAIDE);
    otherBuilding = await contextFor(PEOPLE.ivanPresident, LISPENARD);
  });

  describe("recording it", () => {
    it("lets any officer record work and its estimate", async () => {
      // Planning costs nobody anything, so it is not the treasurer's alone.
      const result = await createWork(president, {
        title: "Replace the roof",
        detail: "Two quotes in. Brennan Roofing preferred.",
        estimateCents: 4_200_000,
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const work = await getWork(president, result.data.workId);
      expect(work?.title).toEqual("Replace the roof");
      expect(work?.estimateCents).toEqual(4_200_000);
      expect(work?.status).toEqual("PROPOSED");
      expect(work?.assessmentRaisedAt).toBeNull();
    });

    it("refuses a plain shareholder", async () => {
      await expect(
        createWork(shareholder, { title: "Gold-plate the lobby" }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });

    it("shows the work to every member, not just officers", async () => {
      // Building-wide by design: a shareholder about to be assessed for a roof
      // may see the estimate without having to ask an officer for it.
      const created = await createWork(president, {
        title: `Boiler service ${randomUUID().slice(0, 8)}`,
        estimateCents: 180_000,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await approve(president, created.data.workId);

      const seen = await listWork(shareholder);
      expect(seen.some((item) => item.id === created.data.workId)).toBe(true);
    });

    it("keeps work inside its own building", async () => {
      const created = await createWork(president, {
        title: `Adelaide-only job ${randomUUID().slice(0, 8)}`,
        estimateCents: 50_000,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await approve(president, created.data.workId);

      expect(await getWork(otherBuilding, created.data.workId)).toBeNull();
    });
  });

  describe("the split", () => {
    it("matches what the shareholder is shown to what they are charged", async () => {
      const dueOn = freshDueDate();
      const total = 4_200_001; // Deliberately indivisible.

      const created = await createWork(president, {
        title: `Roof ${randomUUID().slice(0, 8)}`,
        estimateCents: total,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      await approve(president, created.data.workId);

      // What the interface shows before anything is raised.
      const units = await listUnitsWithShares(treasurer, dueOn);
      const shown = splitLines(
        units.map((unit) => ({
          unitId: unit.id,
          label: unit.label,
          shares: unit.shares,
        })),
        total,
      );

      const raised = await raiseAssessment(treasurer, created.data.workId, {
        dueOn,
        totalCents: total,
      });
      expect(raised.ok).toBe(true);
      if (!raised.ok) return;

      // …and what actually landed on the ledgers.
      const charged = new Map(
        raised.data.lines.map((line) => [line.unitId, line.amountCents]),
      );

      for (const line of shown) {
        expect(
          charged.get(line.unitId),
          `${line.label} was shown ${line.amountCents} and charged ${charged.get(line.unitId)}`,
        ).toEqual(line.amountCents);
      }

      const sum = raised.data.lines.reduce((n, line) => n + line.amountCents, 0);
      expect(sum, "the parts must add up to the total exactly").toEqual(total);
    });

    it("gives the larger shareholder the larger bill", async () => {
      const dueOn = freshDueDate();
      const created = await createWork(president, {
        title: `Facade ${randomUUID().slice(0, 8)}`,
        estimateCents: 900_000,
      });
      if (!created.ok) return;
      await approve(president, created.data.workId);

      const raised = await raiseAssessment(treasurer, created.data.workId, { dueOn });
      expect(raised.ok).toBe(true);
      if (!raised.ok) return;

      const sorted = [...raised.data.lines].sort((a, b) => b.shares - a.shares);
      const most = sorted[0];
      const least = sorted[sorted.length - 1];
      if (!most || !least) return;

      expect(most.amountCents).toBeGreaterThan(least.amountCents);
    });
  });

  describe("the board's decision", () => {
    it("refuses to raise an assessment nobody voted on", async () => {
      // The point of the whole feature: money follows a vote, not a form.
      const created = await createWork(president, {
        title: `Unvoted ${randomUUID().slice(0, 8)}`,
        estimateCents: 500_000,
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      const result = await raiseAssessment(treasurer, created.data.workId, {
        dueOn: freshDueDate(),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("conflict");
      expect(result.message).toMatch(/decision/i);
    });

    it("refuses to raise one the board voted down", async () => {
      const created = await createWork(president, {
        title: `Voted down ${randomUUID().slice(0, 8)}`,
        estimateCents: 500_000,
      });
      if (!created.ok) return;

      const decision = await recordDecision(president, created.data.workId, {
        decidedOn: makeDate(2028, 4, 2),
        votesFor: 1,
        votesAgainst: 4,
      });
      expect(decision.ok).toBe(true);
      if (!decision.ok) return;
      expect(decision.data.carried).toBe(false);

      const result = await raiseAssessment(treasurer, created.data.workId, {
        dueOn: freshDueDate(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("conflict");
    });

    it("does not let abstentions decide it", async () => {
      // 2-1 with three abstaining carries: a majority of the votes cast.
      const created = await createWork(president, {
        title: `Abstentions ${randomUUID().slice(0, 8)}`,
        estimateCents: 100_000,
      });
      if (!created.ok) return;

      const decision = await recordDecision(president, created.data.workId, {
        decidedOn: makeDate(2028, 5, 9),
        votesFor: 2,
        votesAgainst: 1,
        votesAbstain: 3,
      });
      expect(decision.ok).toBe(true);
      if (!decision.ok) return;
      expect(decision.data.carried).toBe(true);

      expect(
        (
          await raiseAssessment(treasurer, created.data.workId, {
            dueOn: freshDueDate(),
          })
        ).ok,
      ).toBe(true);
    });

    it("refuses a tally with no votes cast either way", async () => {
      const created = await createWork(president, {
        title: `Empty tally ${randomUUID().slice(0, 8)}`,
        estimateCents: 100_000,
      });
      if (!created.ok) return;

      const result = await recordDecision(president, created.data.workId, {
        decidedOn: makeDate(2028, 6, 1),
        votesFor: 0,
        votesAgainst: 0,
        votesAbstain: 5,
      });
      expect(result.ok).toBe(false);
    });

    it("is refused to a plain shareholder", async () => {
      const created = await createWork(president, {
        title: `Not theirs ${randomUUID().slice(0, 8)}`,
        estimateCents: 100_000,
      });
      if (!created.ok) return;

      await expect(
        recordDecision(shareholder, created.data.workId, {
          decidedOn: makeDate(2028, 7, 1),
          votesFor: 5,
          votesAgainst: 0,
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });

    it("freezes the decision once money has been raised on it", async () => {
      const created = await createWork(president, {
        title: `Frozen ${randomUUID().slice(0, 8)}`,
        estimateCents: 100_000,
      });
      if (!created.ok) return;
      await approve(president, created.data.workId);

      expect(
        (
          await raiseAssessment(treasurer, created.data.workId, {
            dueOn: freshDueDate(),
          })
        ).ok,
      ).toBe(true);

      // Rewriting the vote afterwards would leave real charges explained by a
      // tally that has since changed.
      const result = await recordDecision(president, created.data.workId, {
        decidedOn: makeDate(2028, 8, 1),
        votesFor: 0,
        votesAgainst: 5,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("conflict");
    });
  });

  describe("raising the assessment", () => {
    it("is refused to an officer who is not the treasurer", async () => {
      // The president can record the work and can't turn it into debt.
      const created = await createWork(president, {
        title: `Cornice ${randomUUID().slice(0, 8)}`,
        estimateCents: 120_000,
      });
      if (!created.ok) return;
      await approve(president, created.data.workId);

      await expect(
        raiseAssessment(president, created.data.workId, { dueOn: freshDueDate() }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });

    it("puts a real charge on every apartment's ledger", async () => {
      const dueOn = freshDueDate();
      const created = await createWork(president, {
        title: `Stoop ${randomUUID().slice(0, 8)}`,
        estimateCents: 300_000,
      });
      if (!created.ok) return;
      await approve(president, created.data.workId);

      const before = await unitLedger(treasurer, (await anyUnitId(treasurer)) ?? "");

      const raised = await raiseAssessment(treasurer, created.data.workId, { dueOn });
      expect(raised.ok).toBe(true);
      if (!raised.ok) return;

      const unitId = await anyUnitId(treasurer);
      if (!unitId) return;

      const after = await unitLedger(treasurer, unitId);
      expect(after.charges.length).toBeGreaterThan(before.charges.length);

      const linked = await assessmentCharges(treasurer, created.data.workId);
      expect(linked.length).toEqual(raised.data.lines.length);
      expect(linked.every((charge) => charge.amountCents > 0)).toBe(true);
    });

    it("refuses to raise the same assessment twice", async () => {
      const created = await createWork(president, {
        title: `Windows ${randomUUID().slice(0, 8)}`,
        estimateCents: 250_000,
      });
      if (!created.ok) return;
      await approve(president, created.data.workId);

      expect(
        (
          await raiseAssessment(treasurer, created.data.workId, {
            dueOn: freshDueDate(),
          })
        ).ok,
      ).toBe(true);

      const again = await raiseAssessment(treasurer, created.data.workId, {
        dueOn: freshDueDate(),
      });
      expect(again.ok).toBe(false);
      if (again.ok) return;
      expect(again.code).toEqual("conflict");
    });

    it("refuses when nobody has said what it costs", async () => {
      const created = await createWork(president, {
        title: `Unknown cost ${randomUUID().slice(0, 8)}`,
      });
      if (!created.ok) return;
      await approve(president, created.data.workId);

      const result = await raiseAssessment(treasurer, created.data.workId, {
        dueOn: freshDueDate(),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("invalid");
    });

    it("locks the estimate once money has been raised against it", async () => {
      // The estimate is what the assessment was justified by. Changing it after
      // the fact would leave the charges on the ledger unexplained.
      const created = await createWork(president, {
        title: `Locked ${randomUUID().slice(0, 8)}`,
        estimateCents: 100_000,
      });
      if (!created.ok) return;
      await approve(president, created.data.workId);

      expect(
        (
          await raiseAssessment(treasurer, created.data.workId, {
            dueOn: freshDueDate(),
          })
        ).ok,
      ).toBe(true);

      const result = await updateWork(president, created.data.workId, {
        estimateCents: 999_999,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("conflict");
    });
  });
});

async function anyUnitId(ctx: BuildingContext): Promise<string | undefined> {
  return (await listUnitsWithShares(ctx))[0]?.id;
}
