import { beforeAll, describe, expect, it } from "vitest";
import { CapabilityError } from "~/lib/auth/capabilities";
import type { BuildingContext } from "~/lib/db/context";
import {
  postCharge,
  postMonthlyMaintenance,
  recordPayment,
  reverseCharge,
  reversePayment,
} from "~/lib/db/scoped/ledger-writes";
import { buildingLedger, unitLedger } from "~/lib/db/scoped/ledger";
import { listUnitsWithShares } from "~/lib/db/scoped/units";
import { agingFor } from "~/lib/primitives/ledger";
import { makeDate, toPlainDate, type PlainDate } from "~/lib/time";
import { ADELAIDE, LISPENARD, PEOPLE, contextFor } from "../helpers/context";

/**
 * The ledger, against the real database.
 *
 * Money is the part of this product where a bug is not an inconvenience: a
 * wrong number here is a neighbour dunned for rent they paid, or a building
 * quietly under-collecting for a year. So these tests are written against the
 * ways that actually happens — a double-posted month, a reversal that credits
 * the wrong bucket, a shareholder who can see the whole building's arrears.
 *
 * Like the other module suites this mutates the seeded building rather than
 * using fixtures, so it exercises the real scoped write path under row-level
 * security. Nothing here may assert on absolute row counts.
 */

/** A month far enough out that the seed has never posted maintenance in it. */
function futureMonth(offset: number): PlainDate {
  return makeDate(2031, offset, 1);
}

describe("the ledger", () => {
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

  describe("who may write", () => {
    it("refuses a plain shareholder", async () => {
      const unitId = shareholder.unitIds[0];
      expect(unitId).toBeDefined();
      if (!unitId) return;

      await expect(
        postCharge(shareholder, {
          unitId,
          kind: "OTHER",
          amountCents: 1000,
          dueOn: futureMonth(1),
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });

    it("refuses the president, who may look but not post", async () => {
      // Deliberate separation: charging a neighbour money takes the specific
      // officer whose job that is, even though the president sees every ledger.
      const unitId = (await listUnitsWithShares(president))[0]?.id;
      expect(unitId).toBeDefined();
      if (!unitId) return;

      await expect(
        postCharge(president, {
          unitId,
          kind: "OTHER",
          amountCents: 1000,
          dueOn: futureMonth(1),
        }),
      ).rejects.toBeInstanceOf(CapabilityError);

      await expect(
        recordPayment(president, {
          unitId,
          amountCents: 1000,
          receivedOn: futureMonth(1),
          method: "CHECK",
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });
  });

  describe("posting and recording", () => {
    it("posts a charge and shows it on that unit's ledger", async () => {
      const unitId = (await listUnitsWithShares(treasurer))[0]?.id;
      expect(unitId).toBeDefined();
      if (!unitId) return;

      const result = await postCharge(treasurer, {
        unitId,
        kind: "MOVE_FEE",
        amountCents: 25_000,
        dueOn: futureMonth(2),
        memo: "Freight elevator",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const { charges } = await unitLedger(treasurer, unitId);
      const posted = charges.find((c) => c.id === result.data.chargeId);
      expect(posted?.amountCents).toEqual(25_000);
      expect(posted?.memo).toEqual("Freight elevator");
    });

    it("refuses a charge against an apartment in another building", async () => {
      const strayUnit = (await listUnitsWithShares(otherBuilding))[0]?.id;
      expect(strayUnit).toBeDefined();
      if (!strayUnit) return;

      // Row-level security means the unit simply is not there to be found.
      const result = await postCharge(treasurer, {
        unitId: strayUnit,
        kind: "OTHER",
        amountCents: 5_000,
        dueOn: futureMonth(3),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("not_found");
    });

    it("refuses amounts that are zero, negative, or a plain typo", async () => {
      const unitId = (await listUnitsWithShares(treasurer))[0]?.id;
      if (!unitId) return;

      for (const amountCents of [0, -500, 100_000_001]) {
        const result = await postCharge(treasurer, {
          unitId,
          kind: "OTHER",
          amountCents,
          dueOn: futureMonth(3),
        });
        expect(result.ok, `${amountCents} should be refused`).toBe(false);
      }
    });
  });

  describe("reversal", () => {
    it("nets a reversed charge out of the aging entirely", async () => {
      const unitId = (await listUnitsWithShares(treasurer))[0]?.id;
      if (!unitId) return;

      const before = await agingNow(treasurer, unitId);

      const charge = await postCharge(treasurer, {
        unitId,
        kind: "ASSESSMENT",
        amountCents: 40_000,
        // Due in the past, so it lands in the aging rather than sitting ahead.
        dueOn: makeDate(2024, 3, 1),
      });
      expect(charge.ok).toBe(true);
      if (!charge.ok) return;

      const during = await agingNow(treasurer, unitId);
      expect(during).toEqual(before + 40_000);

      const reversal = await reverseCharge(
        treasurer,
        charge.data.chargeId,
        "Charged in error — wrong apartment",
      );
      expect(reversal.ok).toBe(true);

      // Back exactly where it started: the pair cancels in the bucket the
      // original sat in, rather than crediting today.
      expect(await agingNow(treasurer, unitId)).toEqual(before);
    });

    it("refuses to reverse the same charge twice", async () => {
      const unitId = (await listUnitsWithShares(treasurer))[0]?.id;
      if (!unitId) return;

      const charge = await postCharge(treasurer, {
        unitId,
        kind: "OTHER",
        amountCents: 1_500,
        dueOn: makeDate(2024, 4, 1),
      });
      if (!charge.ok) return;

      expect(
        (await reverseCharge(treasurer, charge.data.chargeId, "duplicate")).ok,
      ).toBe(true);

      const again = await reverseCharge(treasurer, charge.data.chargeId, "duplicate");
      expect(again.ok).toBe(false);
      if (again.ok) return;
      expect(again.code).toEqual("conflict");
    });

    it("requires a reason", async () => {
      const unitId = (await listUnitsWithShares(treasurer))[0]?.id;
      if (!unitId) return;

      const charge = await postCharge(treasurer, {
        unitId,
        kind: "OTHER",
        amountCents: 900,
        dueOn: makeDate(2024, 5, 1),
      });
      if (!charge.ok) return;

      const result = await reverseCharge(treasurer, charge.data.chargeId, "  ");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.fields?.["reason"]).toBeTruthy();
    });

    it("puts a bounced payment back onto the balance", async () => {
      const unitId = (await listUnitsWithShares(treasurer))[0]?.id;
      if (!unitId) return;

      await postCharge(treasurer, {
        unitId,
        kind: "OTHER",
        amountCents: 7_000,
        dueOn: makeDate(2024, 6, 1),
      });
      const owed = await agingNow(treasurer, unitId);

      const payment = await recordPayment(treasurer, {
        unitId,
        amountCents: 7_000,
        receivedOn: makeDate(2024, 6, 2),
        method: "CHECK",
        reference: "9001",
      });
      expect(payment.ok).toBe(true);
      if (!payment.ok) return;

      expect(await agingNow(treasurer, unitId)).toEqual(owed - 7_000);

      const reversed = await reversePayment(
        treasurer,
        payment.data.paymentId,
        "Cheque returned unpaid",
      );
      expect(reversed.ok).toBe(true);

      expect(await agingNow(treasurer, unitId)).toEqual(owed);
    });
  });

  describe("the monthly maintenance run", () => {
    it("splits by shares, to the cent", async () => {
      const dueOn = futureMonth(4);
      // A total that does not divide evenly, so the remainder logic is exercised.
      const total = 1_000_001;

      const result = await postMonthlyMaintenance(treasurer, {
        dueOn,
        totalCents: total,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const sum = result.data.lines.reduce((n, line) => n + line.amountCents, 0);
      expect(sum, "the split must add up to the total exactly").toEqual(total);
      expect(result.data.charged).toBeGreaterThan(1);
    });

    it("gives the larger shareholder the larger charge", async () => {
      const dueOn = futureMonth(5);
      const units = await listUnitsWithShares(treasurer, dueOn);

      const result = await postMonthlyMaintenance(treasurer, {
        dueOn,
        totalCents: 900_000,
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const byLabel = new Map(
        result.data.lines.map((l) => [l.unitLabel, l.amountCents]),
      );
      const sorted = [...units].sort((a, b) => b.shares - a.shares);
      const most = sorted[0];
      const least = sorted[sorted.length - 1];
      expect(most && least).toBeTruthy();
      if (!most || !least) return;

      expect(byLabel.get(most.label) ?? 0).toBeGreaterThan(
        byLabel.get(least.label) ?? 0,
      );
    });

    it("refuses to post the same month twice", async () => {
      const dueOn = futureMonth(6);

      expect(
        (await postMonthlyMaintenance(treasurer, { dueOn, totalCents: 500_000 })).ok,
      ).toBe(true);

      // The failure this prevents is a double-submitted form charging every
      // apartment twice, which takes an evening to unpick by hand.
      const again = await postMonthlyMaintenance(treasurer, {
        dueOn,
        totalCents: 500_000,
      });
      expect(again.ok).toBe(false);
      if (again.ok) return;
      expect(again.code).toEqual("conflict");
    });

    it("stays inside its own building", async () => {
      const dueOn = futureMonth(7);
      const before = await buildingLedger(otherBuilding);

      expect(
        (await postMonthlyMaintenance(treasurer, { dueOn, totalCents: 300_000 })).ok,
      ).toBe(true);

      const after = await buildingLedger(otherBuilding);
      expect(after.charges.length).toEqual(before.charges.length);
    });
  });

  describe("what a shareholder can see", () => {
    it("shows them their own ledger and nobody else's", async () => {
      const own = shareholder.unitIds[0];
      expect(own).toBeDefined();
      if (!own) return;

      const mine = await unitLedger(shareholder, own);
      expect(mine.charges.every((c) => c.unitId === own)).toBe(true);

      const neighbour = (await listUnitsWithShares(treasurer)).find(
        (unit) => unit.id !== own,
      );
      expect(neighbour).toBeDefined();
      if (!neighbour) return;

      const theirs = await unitLedger(shareholder, neighbour.id);
      expect(theirs.charges).toHaveLength(0);
      expect(theirs.payments).toHaveLength(0);
    });

    it("refuses them the building-wide report outright", async () => {
      await expect(buildingLedger(shareholder)).rejects.toBeInstanceOf(CapabilityError);
    });
  });
});

/** The unit's total owed right now, through the real aging arithmetic. */
async function agingNow(ctx: BuildingContext, unitId: string): Promise<number> {
  const { charges, payments } = await unitLedger(ctx, unitId);
  return agingFor(
    charges.map((c) => ({
      id: c.id,
      unitId: c.unitId,
      amountCents: c.amountCents,
      dueOn: toPlainDate(c.dueOn),
      reversesChargeId: c.reversesChargeId,
    })),
    payments.map((p) => ({
      id: p.id,
      unitId: p.unitId,
      amountCents: p.amountCents,
      receivedOn: toPlainDate(p.receivedOn),
      reversesPaymentId: p.reversesPaymentId,
    })),
    makeDate(2030, 1, 1),
  ).total;
}
