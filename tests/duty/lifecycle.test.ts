import { beforeAll, describe, expect, it } from "vitest";
import { CapabilityError } from "~/lib/auth/capabilities";
import { listObligations } from "~/lib/db/scoped/compliance";
import type { BuildingContext } from "~/lib/db/context";
import {
  currentTurns,
  getFine,
  getRotation,
  listFines,
  liveCharges,
  turnForDate,
  turnsPerUnit,
} from "~/lib/db/scoped/duty";
import {
  chargeFineToUnit,
  createRotation,
  generateTurns,
  logFine,
  setRotationActive,
  swapTurns,
  updateFine,
} from "~/lib/db/scoped/duty-writes";
import { unitLedger } from "~/lib/db/scoped/ledger";
import { listUnitsWithShares } from "~/lib/db/scoped/units";
import { expect as unwrap } from "~/lib/result";
import { addDays, makeDate, today, toPlainDate, type PlainDate } from "~/lib/time";
import { ADELAIDE, LISPENARD, PEOPLE, contextFor } from "../helpers/context";

/**
 * The duty rotation, and the fine that arrives three weeks later.
 *
 * The claim under test is the one the module exists for: when a sanitation
 * summons turns up long after the violation, the building can say whose week it
 * was — and say it correctly when two neighbours swapped, which is precisely
 * the case where memory and the rota disagree.
 */

let rotations = 0;

describe("the duty rotation", () => {
  let president: BuildingContext;
  let treasurer: BuildingContext;
  let sal: BuildingContext; // the super, who holds duty.manage and no money
  let hal: BuildingContext; // garden apartment
  let marta: BuildingContext; // 2R
  let otherBuilding: BuildingContext;

  let order: string[];
  let labels: Map<string, string>;

  beforeAll(async () => {
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    treasurer = await contextFor(PEOPLE.desmondTreasurer, ADELAIDE);
    sal = await contextFor(PEOPLE.salSuper, ADELAIDE);
    hal = await contextFor(PEOPLE.halShareholder, ADELAIDE);
    marta = await contextFor(PEOPLE.martaBoth, ADELAIDE);
    otherBuilding = await contextFor(PEOPLE.ivanPresident, LISPENARD);

    const units = await listUnitsWithShares(president);
    labels = new Map(units.map((unit) => [unit.id, unit.label]));
    // GARDEN first, then 2R — so the first turn is Hal's and the second Marta's.
    order = [
      units.find((u) => u.label === "GARDEN")!.id,
      units.find((u) => u.label === "2R")!.id,
      units.find((u) => u.label === "4F")!.id,
    ];
  });

  /** A fresh weekly rotation starting on a Monday well clear of the seed. */
  async function freshRotation(
    ctx: BuildingContext,
    startsOn: PlainDate,
  ): Promise<string> {
    rotations += 1;
    return unwrap(
      await createRotation(ctx, {
        name: `Bins ${rotations} of ${Date.now().toString(36)}`,
        unitOrder: order,
        startsOn,
        periodDays: 7,
      }),
    ).rotationId;
  }

  describe("setting it up", () => {
    it("stores the order, because the order is the point", async () => {
      const id = await freshRotation(president, makeDate(2032, 4, 5));

      const rotation = await getRotation(president, id);
      expect(rotation?.unitOrder).toEqual(order);
      expect(rotation?.periodDays).toEqual(7);
      expect(rotation?.active).toBe(true);
    });

    it("lets the super set one up, because it is the super's job", async () => {
      const result = await createRotation(sal, {
        name: `Recycling ${Date.now().toString(36)}`,
        kind: "RECYCLING_SET_OUT",
        unitOrder: order,
        startsOn: makeDate(2032, 4, 5),
      });
      expect(result.ok).toBe(true);
    });

    it("refuses a plain shareholder", async () => {
      await expect(
        createRotation(hal, {
          name: "My own rota",
          unitOrder: order,
          startsOn: makeDate(2032, 4, 5),
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });

    it("refuses an apartment listed twice", async () => {
      const result = await createRotation(president, {
        name: "Doubled up",
        unitOrder: [order[0]!, order[1]!, order[0]!],
        startsOn: makeDate(2032, 4, 5),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/appears twice/);
    });

    it("refuses an empty rotation", async () => {
      const result = await createRotation(president, {
        name: "Nobody",
        unitOrder: [],
        startsOn: makeDate(2032, 4, 5),
      });
      expect(result.ok).toBe(false);
    });

    it("refuses an apartment from another building", async () => {
      const theirs = await listUnitsWithShares(otherBuilding);
      const result = await createRotation(president, {
        name: "Next door",
        unitOrder: [order[0]!, theirs[0]!.id],
        startsOn: makeDate(2032, 4, 5),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("not_found");
    });
  });

  describe("generating the turns", () => {
    it("materialises a row per period, each with a reminder behind it", async () => {
      const id = await freshRotation(president, makeDate(2033, 4, 4));
      const made = unwrap(await generateTurns(president, id, { count: 6 }));

      expect(made.created).toEqual(6);

      const rotation = await getRotation(president, id);
      expect(rotation?.assignments).toHaveLength(6);

      // Three apartments, six turns, two each.
      const counts = turnsPerUnit(rotation!.assignments);
      expect([...counts.values()]).toEqual([2, 2, 2]);

      // A rotation nobody is reminded of is a rota on a fridge door.
      const obligations = await listObligations(president);
      const first = rotation!.assignments[0]!;
      expect(first.obligationId).not.toBeNull();
      expect(obligations.find((o) => o.id === first.obligationId)?.kind).toEqual(
        "DUTY",
      );
    });

    it("runs in order, a week each, with no gaps", async () => {
      const id = await freshRotation(president, makeDate(2034, 4, 3));
      unwrap(await generateTurns(president, id, { count: 4 }));

      const { assignments } = (await getRotation(president, id))!;
      expect(assignments.map((a) => labels.get(a.unitId))).toEqual([
        "GARDEN",
        "2R",
        "4F",
        "GARDEN",
      ]);

      for (let i = 1; i < assignments.length; i += 1) {
        const previousEnd = toPlainDate(assignments[i - 1]!.periodEnd);
        expect(toPlainDate(assignments[i]!.periodStart)).toEqual(
          addDays(previousEnd, 1),
        );
      }
    });

    it("extends the rota without duplicating what is already there", async () => {
      const id = await freshRotation(president, makeDate(2035, 4, 2));
      unwrap(await generateTurns(president, id, { count: 3 }));
      const again = unwrap(await generateTurns(president, id, { count: 3 }));

      expect(again.created).toEqual(3);
      expect((await getRotation(president, id))?.assignments).toHaveLength(6);
    });

    it("refuses to generate for a paused rotation", async () => {
      const id = await freshRotation(president, makeDate(2036, 4, 7));
      unwrap(await setRotationActive(president, id, false));

      const result = await generateTurns(president, id, { count: 3 });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/paused/);
    });
  });

  describe("swapping", () => {
    it("moves the turn and keeps both names", async () => {
      const id = await freshRotation(president, makeDate(2037, 4, 6));
      unwrap(await generateTurns(president, id, { count: 4 }));
      const { assignments } = (await getRotation(president, id))!;

      // Hal's week and Marta's week trade places.
      unwrap(
        await swapTurns(hal, {
          assignmentId: assignments[0]!.id,
          withAssignmentId: assignments[1]!.id,
        }),
      );

      const after = (await getRotation(president, id))!.assignments;
      expect(labels.get(after[0]!.unitId)).toEqual("2R");
      expect(labels.get(after[1]!.unitId)).toEqual("GARDEN");

      // And the rotation's own answer survives alongside it, so "GARDEN's
      // week, taken by 2R" is still sayable.
      expect(labels.get(after[0]!.originalUnitId!)).toEqual("GARDEN");
      expect(after[0]!.swappedAt).not.toBeNull();
    });

    it("lets a shareholder swap a turn that is theirs, and no one else's", async () => {
      const id = await freshRotation(president, makeDate(2038, 4, 5));
      unwrap(await generateTurns(president, id, { count: 4 }));
      const { assignments } = (await getRotation(president, id))!;

      // Turns 2 and 3 belong to 2R and 4F. Hal holds neither.
      const result = await swapTurns(hal, {
        assignmentId: assignments[1]!.id,
        withAssignmentId: assignments[2]!.id,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("forbidden");

      // Marta holds 2R, so she may.
      expect(
        (
          await swapTurns(marta, {
            assignmentId: assignments[1]!.id,
            withAssignmentId: assignments[2]!.id,
          })
        ).ok,
      ).toBe(true);
    });

    it("refuses to swap a week that has already happened", async () => {
      // A rotation that started well in the past, so its first turns are over.
      const id = await freshRotation(president, makeDate(2020, 4, 6));
      unwrap(
        await generateTurns(president, id, { count: 3, from: makeDate(2020, 4, 6) }),
      );
      const { assignments } = (await getRotation(president, id))!;

      const result = await swapTurns(president, {
        assignmentId: assignments[0]!.id,
        withAssignmentId: assignments[1]!.id,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/already passed/);
    });

    it("refuses a turn swapped with itself", async () => {
      const id = await freshRotation(president, makeDate(2039, 4, 4));
      unwrap(await generateTurns(president, id, { count: 2 }));
      const { assignments } = (await getRotation(president, id))!;

      const result = await swapTurns(president, {
        assignmentId: assignments[0]!.id,
        withAssignmentId: assignments[0]!.id,
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("whose week was it", () => {
    it("answers from the rota, not from anybody's memory", async () => {
      const start = makeDate(2041, 4, 1);
      const id = await freshRotation(president, start);
      unwrap(await generateTurns(president, id, { count: 6, from: start }));
      const rotation = (await getRotation(president, id))!;

      // Day 9 is in the second turn, which is 2R's.
      const answer = turnForDate(rotation, rotation.assignments, addDays(start, 9));
      expect(labels.get(answer!.unitId)).toEqual("2R");
    });

    it("follows the swap rather than the formula", async () => {
      const start = makeDate(2042, 4, 1);
      const id = await freshRotation(president, start);
      unwrap(await generateTurns(president, id, { count: 4, from: start }));
      const before = (await getRotation(president, id))!;

      unwrap(
        await swapTurns(president, {
          assignmentId: before.assignments[0]!.id,
          withAssignmentId: before.assignments[1]!.id,
        }),
      );

      const after = (await getRotation(president, id))!;
      // The formula still says GARDEN had the first week. The record says 2R
      // took it, and the record is what a fine has to be answered with.
      const answer = turnForDate(after, after.assignments, addDays(start, 2));
      expect(labels.get(answer!.unitId)).toEqual("2R");
    });
  });

  describe("the fine", () => {
    /** A rotation covering a past window, so a summons can land inside it. */
    async function pastRotation(start: PlainDate): Promise<string> {
      const id = await freshRotation(president, start);
      unwrap(await generateTurns(president, id, { count: 8, from: start }));
      return id;
    }

    it("attributes itself to whoever had that week", async () => {
      const start = makeDate(2019, 4, 1);
      await pastRotation(start);

      // A summons dated nine days in — the second turn, which is 2R's.
      const logged = unwrap(
        await logFine(president, {
          ticketNumber: `S-${Date.now().toString(36)}-a`,
          issuedOn: addDays(start, 9),
          violation: "Receptacle set out before 6pm",
          amountCents: 10_000,
        }),
      );

      expect(labels.get(logged.attributedUnitId!)).toEqual("2R");

      const fine = await getFine(president, logged.fineId);
      expect(fine?.dutyAssignmentId).not.toBeNull();
      expect(fine?.dutyAssignment?.unit.label).toEqual("2R");
    });

    it("follows a swap, which is the case memory gets wrong", async () => {
      // A rotation whose first turn is running right now: it started three days
      // ago, so a summons can be dated inside it and it is still swappable.
      const start = addDays(today(), -3);
      const id = await freshRotation(president, start);
      unwrap(await generateTurns(president, id, { count: 4, from: start }));

      const before = (await getRotation(president, id))!;
      expect(labels.get(before.assignments[0]!.unitId)).toEqual("GARDEN");

      // GARDEN and 2R trade weeks, so 2R is the one who should have put the
      // bins out — and the one the summons belongs to.
      unwrap(
        await swapTurns(president, {
          assignmentId: before.assignments[0]!.id,
          withAssignmentId: before.assignments[1]!.id,
        }),
      );

      const logged = unwrap(
        await logFine(president, {
          ticketNumber: `S-${Date.now().toString(36)}-b`,
          issuedOn: addDays(today(), -1),
          violation: "Dirty sidewalk",
          amountCents: 5_000,
        }),
      );

      // The formula still says GARDEN. The record says 2R took the week, and
      // the record is what a fine has to be answered with.
      expect(labels.get(logged.attributedUnitId!)).toEqual("2R");

      const fine = await getFine(president, logged.fineId);
      expect(fine?.dutyAssignment?.unit.label).toEqual("2R");
      expect(labels.get(fine!.dutyAssignment!.originalUnitId!)).toEqual("GARDEN");
    });

    it("has nobody to blame when the rota did not cover the day", async () => {
      const logged = unwrap(
        await logFine(president, {
          ticketNumber: `S-${Date.now().toString(36)}-c`,
          // Long before any rotation in this suite begins.
          issuedOn: makeDate(2011, 5, 4),
          violation: "Failure to recycle",
          amountCents: 2_500,
        }),
      );

      expect(logged.attributedUnitId).toBeNull();

      const result = await chargeFineToUnit(treasurer, logged.fineId, {
        dueOn: makeDate(2011, 7, 1),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/nobody to bill/);
    });

    it("puts the answer-by date on the calendar when the summons carries one", async () => {
      const start = makeDate(2017, 4, 3);
      await pastRotation(start);

      const logged = unwrap(
        await logFine(president, {
          ticketNumber: `S-${Date.now().toString(36)}-d`,
          issuedOn: addDays(start, 3),
          violation: "Receptacle set out before 6pm",
          amountCents: 10_000,
          hearingOn: addDays(start, 33),
        }),
      );

      const fine = await getFine(president, logged.fineId);
      expect(fine?.obligationId).not.toBeNull();

      const obligations = await listObligations(president);
      const answerBy = obligations.find((o) => o.id === fine?.obligationId);
      expect(answerBy?.title).toMatch(/Answer sanitation summons/);
      // Missing the window is how a contestable fine becomes an unarguable one.
      expect(toPlainDate(answerBy!.dueOn)).toEqual(addDays(start, 33));
    });

    it("closes that reminder once the summons is answered", async () => {
      const start = makeDate(2016, 4, 4);
      await pastRotation(start);

      const logged = unwrap(
        await logFine(president, {
          ticketNumber: `S-${Date.now().toString(36)}-e`,
          issuedOn: addDays(start, 3),
          violation: "Dirty sidewalk",
          amountCents: 5_000,
          hearingOn: addDays(start, 30),
        }),
      );
      const fine = await getFine(president, logged.fineId);

      unwrap(
        await updateFine(president, logged.fineId, {
          contestedOn: addDays(start, 10),
          outcome: "Requested a hearing.",
        }),
      );

      const obligations = await listObligations(president);
      expect(obligations.find((o) => o.id === fine?.obligationId)?.state).toEqual(
        "COMPLETED",
      );
    });

    it("refuses a hearing date before the summons was issued", async () => {
      const result = await logFine(president, {
        ticketNumber: `S-${Date.now().toString(36)}-f`,
        issuedOn: makeDate(2015, 6, 1),
        violation: "Dirty sidewalk",
        amountCents: 5_000,
        hearingOn: makeDate(2015, 5, 1),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("invalid");
    });

    it("refuses the same summons number twice", async () => {
      const ticketNumber = `S-${Date.now().toString(36)}-g`;
      unwrap(
        await logFine(president, {
          ticketNumber,
          issuedOn: makeDate(2014, 6, 1),
          violation: "Dirty sidewalk",
          amountCents: 5_000,
        }),
      );

      const second = await logFine(president, {
        ticketNumber,
        issuedOn: makeDate(2014, 6, 1),
        violation: "Dirty sidewalk",
        amountCents: 5_000,
      });

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.message).toMatch(/already on record/);
    });

    it("refuses a plain shareholder logging one", async () => {
      await expect(
        logFine(hal, {
          ticketNumber: "S-nope",
          issuedOn: makeDate(2013, 6, 1),
          violation: "Something",
          amountCents: 5_000,
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });
  });

  describe("recharging it", () => {
    it("bills the apartment whose week it was, and it lands on the ledger", async () => {
      const start = makeDate(2012, 4, 2);
      const id = await freshRotation(president, start);
      unwrap(await generateTurns(president, id, { count: 8, from: start }));

      const logged = unwrap(
        await logFine(president, {
          ticketNumber: `S-${Date.now().toString(36)}-h`,
          issuedOn: addDays(start, 2),
          violation: "Receptacle set out before 6pm",
          amountCents: 10_000,
        }),
      );
      expect(labels.get(logged.attributedUnitId!)).toEqual("GARDEN");

      const charged = unwrap(
        await chargeFineToUnit(treasurer, logged.fineId, {
          dueOn: makeDate(2012, 7, 1),
        }),
      );

      const fine = await getFine(treasurer, logged.fineId);
      expect(liveCharges(fine!.charges)).toHaveLength(1);

      const ledger = await unitLedger(treasurer, logged.attributedUnitId!);
      const posted = ledger.charges.find((c) => c.id === charged.chargeId);
      expect(posted?.amountCents).toEqual(10_000);
      expect(posted?.memo).toMatch(/Sanitation summons/);
    });

    it("refuses to bill it twice", async () => {
      const start = makeDate(2010, 4, 5);
      const id = await freshRotation(president, start);
      unwrap(await generateTurns(president, id, { count: 4, from: start }));

      const logged = unwrap(
        await logFine(president, {
          ticketNumber: `S-${Date.now().toString(36)}-i`,
          issuedOn: addDays(start, 1),
          violation: "Dirty sidewalk",
          amountCents: 5_000,
        }),
      );
      unwrap(
        await chargeFineToUnit(treasurer, logged.fineId, {
          dueOn: makeDate(2010, 7, 1),
        }),
      );

      const second = await chargeFineToUnit(treasurer, logged.fineId, {
        dueOn: makeDate(2010, 7, 1),
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.message).toMatch(/already been recharged/);
    });

    it("refuses the super, who runs the rota and holds no money", async () => {
      const start = makeDate(2009, 4, 6);
      const id = await freshRotation(president, start);
      unwrap(await generateTurns(president, id, { count: 4, from: start }));

      const logged = unwrap(
        await logFine(sal, {
          ticketNumber: `S-${Date.now().toString(36)}-j`,
          issuedOn: addDays(start, 1),
          violation: "Dirty sidewalk",
          amountCents: 5_000,
        }),
      );

      await expect(
        chargeFineToUnit(sal, logged.fineId, { dueOn: makeDate(2009, 7, 1) }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });
  });

  describe("tenancy", () => {
    it("keeps one building's rotation out of another's", async () => {
      const id = await freshRotation(president, makeDate(2043, 4, 6));
      expect(await getRotation(otherBuilding, id)).toBeNull();
    });

    it("keeps one building's fines out of another's", async () => {
      const logged = unwrap(
        await logFine(president, {
          ticketNumber: `S-${Date.now().toString(36)}-k`,
          issuedOn: makeDate(2008, 6, 1),
          violation: "Dirty sidewalk",
          amountCents: 5_000,
        }),
      );

      expect(await getFine(otherBuilding, logged.fineId)).toBeNull();
      expect((await listFines(otherBuilding)).map((f) => f.id)).not.toContain(
        logged.fineId,
      );
    });

    it("shows an observer the rota and nothing it could change", async () => {
      // An observer holds duty.view and no duty.manage.
      const rosalind = await contextFor(PEOPLE.rosalindObserver, LISPENARD);
      const turns = await currentTurns(rosalind);
      expect(Array.isArray(turns)).toBe(true);

      await expect(
        createRotation(rosalind, {
          name: "Observer's rota",
          unitOrder: [],
          startsOn: makeDate(2044, 4, 4),
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });
  });
});
