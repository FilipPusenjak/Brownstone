import { beforeAll, describe, expect, it } from "vitest";
import { CapabilityError } from "~/lib/auth/capabilities";
import type { BuildingContext } from "~/lib/db/context";
import {
  addResource,
  cancelBooking,
  confirmBooking,
  recordDeposit,
  requestBooking,
  retireResource,
  returnDeposit,
} from "~/lib/db/scoped/booking-writes";
import {
  dayCalendar,
  evaluateBooking,
  getBooking,
  listBookings,
  listResources,
} from "~/lib/db/scoped/bookings";
import { unitLedger } from "~/lib/db/scoped/ledger";
import { listUnits } from "~/lib/db/scoped/units";
import { withBuildingTx } from "~/lib/db/tx";
import { balance } from "~/lib/primitives/ledger";
import { addDays, instantAt, NYC, toDbDate, today, type PlainDate } from "~/lib/time";
import { ADELAIDE, PEOPLE, contextFor } from "../helpers/context";

/**
 * Booking the freight elevator, against the real database.
 *
 * The module's argument is in three of these tests, and the rest exist to stop
 * the three from quietly becoming vacuous.
 *
 * A slot is *held*, not confirmed — the time comes off the calendar the moment
 * somebody asks for it, so two families do not hire movers for the same
 * Saturday, and the conditions are a separate act.
 *
 * Those conditions are read against **the day of the move**. A certificate
 * that is current today and lapses before the truck arrives does not count,
 * and that single sentence is why this module is not a calendar widget.
 *
 * And nothing can be double-booked — not merely because the write path looks
 * first, but because the database refuses it. The test that proves that one
 * goes around the write path entirely.
 */

/** Far enough out that nothing else in the suite has taken the day. */
function futureDay(offset: number): PlainDate {
  return addDays(today(NYC), 300 + offset);
}

describe("bookings", () => {
  let president: BuildingContext;
  let sup: BuildingContext;
  let shareholder: BuildingContext; // Hal, the garden apartment
  let neighbour: BuildingContext; // Marta, 2R
  let elevatorId: string;
  let halUnit: string;
  let martaUnit: string;

  beforeAll(async () => {
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    sup = await contextFor(PEOPLE.salSuper, ADELAIDE);
    shareholder = await contextFor(PEOPLE.halShareholder, ADELAIDE);
    neighbour = await contextFor(PEOPLE.martaBoth, ADELAIDE);

    const resources = await listResources(president);
    elevatorId = resources[0]!.id;

    const units = await listUnits(president);
    halUnit = units.find((unit) => unit.label === "GARDEN")!.id;
    martaUnit = units.find((unit) => unit.label === "2R")!.id;
  });

  /** Books a slot for Hal and returns its id, failing loudly if it did not. */
  async function bookForHal(day: PlainDate, slotIndex = 0, slots = 1) {
    const result = await requestBooking(shareholder, {
      resourceId: elevatorId,
      unitId: halUnit,
      date: day,
      slotIndex,
      slots,
      note: "Movers arriving.",
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    return result.data.bookingId;
  }

  describe("taking a slot", () => {
    it("holds it, and does not confirm it", async () => {
      // The distinction the whole module rests on. Requesting is not deciding.
      const id = await bookForHal(futureDay(1));
      const booking = await getBooking(shareholder, id);

      expect(booking?.status).toEqual("HELD");
      expect(booking?.confirmedAt).toBeNull();
    });

    it("refuses a slot somebody already holds, and says who", async () => {
      const day = futureDay(2);
      await bookForHal(day);

      const second = await requestBooking(neighbour, {
        resourceId: elevatorId,
        unitId: martaUnit,
        date: day,
        slotIndex: 0,
        slots: 1,
        note: null,
      });

      expect(second.ok).toBe(false);
      expect(!second.ok && second.code).toEqual("conflict");
      // Naming the apartment is the point — "unavailable" sends somebody to the
      // board to ask a question the page could have answered.
      expect(!second.ok && second.message).toContain("GARDEN");
    });

    it("lets the next slot along be booked", async () => {
      // Half-open windows: a move that runs to noon does not block the one that
      // starts at noon. Treating the boundary as a clash would make a long
      // move unsplittable and waste half the calendar.
      const day = futureDay(3);
      await bookForHal(day, 0, 1);

      const next = await requestBooking(neighbour, {
        resourceId: elevatorId,
        unitId: martaUnit,
        date: day,
        slotIndex: 1,
        slots: 1,
        note: null,
      });
      expect(next.ok).toBe(true);
    });

    it("is refused by the database even when the check is bypassed", async () => {
      // Two people pressing the same slot in the same second both read an empty
      // calendar. The read-then-write check above cannot see that; the
      // exclusion constraint can. This goes around the write path deliberately,
      // because a rule the application enforces alone is a rule a race breaks.
      const day = futureDay(4);
      await bookForHal(day);

      const window = {
        startsAt: instantAt(day, "09:00:00", NYC),
        endsAt: instantAt(day, "11:00:00", NYC),
      };

      await expect(
        withBuildingTx(president.building.id, (tx) =>
          tx.booking.create({
            data: {
              buildingId: president.building.id,
              resourceId: elevatorId,
              unitId: martaUnit,
              requestedById: president.membership.id,
              startsAt: window.startsAt,
              endsAt: window.endsAt,
              status: "HELD",
            },
          }),
        ),
      ).rejects.toThrow();
    });

    it("gives the slot back when a booking is cancelled", async () => {
      const day = futureDay(5);
      const id = await bookForHal(day);
      expect((await cancelBooking(shareholder, id, null)).ok).toBe(true);

      const again = await requestBooking(neighbour, {
        resourceId: elevatorId,
        unitId: martaUnit,
        date: day,
        slotIndex: 0,
        slots: 1,
        note: null,
      });
      expect(again.ok).toBe(true);
    });

    it("refuses a slot that has already started", async () => {
      const yesterday = addDays(today(NYC), -1);
      const result = await requestBooking(shareholder, {
        resourceId: elevatorId,
        unitId: halUnit,
        date: yesterday,
        slotIndex: 0,
        slots: 1,
        note: null,
      });
      expect(!result.ok && result.code).toEqual("invalid");
    });

    it("refuses a run that would spill past closing", async () => {
      // Three slots in the day. Asking for two from the second is asking for
      // one that does not exist, and quietly booking one would book half a move.
      const result = await requestBooking(shareholder, {
        resourceId: elevatorId,
        unitId: halUnit,
        date: futureDay(6),
        slotIndex: 2,
        slots: 2,
        note: null,
      });
      expect(!result.ok && result.code).toEqual("invalid");
    });

    it("will not let a shareholder book a neighbour's apartment", async () => {
      const result = await requestBooking(shareholder, {
        resourceId: elevatorId,
        unitId: martaUnit,
        date: futureDay(7),
        slotIndex: 0,
        slots: 1,
        note: null,
      });
      expect(!result.ok && result.code).toEqual("forbidden");
    });

    it("lets the super book for an apartment, having none of their own", async () => {
      // The super holds `booking.manage` and not `booking.request`, and is
      // exactly the person who needs to put a contractor's van on the calendar.
      const result = await requestBooking(sup, {
        resourceId: elevatorId,
        unitId: martaUnit,
        date: futureDay(8),
        slotIndex: 0,
        slots: 1,
        note: "Boiler parts going up.",
      });
      expect(result.ok).toBe(true);
    });
  });

  describe("confirming", () => {
    it("refuses, and names every unmet condition at once", async () => {
      // Somebody missing a deposit and a certificate should be told both now,
      // not discover the second after fixing the first.
      const id = await bookForHal(futureDay(10));
      const result = await confirmBooking(president, id);

      expect(result.ok).toBe(false);
      expect(!result.ok && result.code).toEqual("conflict");
      expect(!result.ok && result.message).toMatch(/[Dd]eposit/);
      expect(!result.ok && result.message).toMatch(/certificate|insurance|insured/i);

      const booking = await getBooking(president, id);
      expect(booking?.status).toEqual("HELD");
    });

    it("writes down what it found, including the failures", async () => {
      // A shareholder who is refused should be able to read exactly which check
      // failed and when it ran, rather than being told "not yet" by somebody
      // who has moved on.
      const id = await bookForHal(futureDay(11));
      await confirmBooking(president, id);

      const booking = await getBooking(shareholder, id);
      expect(booking?.checks.length).toBeGreaterThan(0);
      expect(booking?.checks.every((check) => !check.satisfied)).toBe(true);
      expect(booking?.checks[0]?.note).toBeTruthy();
    });

    it("confirms once every condition holds", async () => {
      const day = futureDay(12);
      const id = await bookForHal(day);

      await giveHalAValidCertificate(day);
      expect(
        (
          await recordDeposit(president, id, {
            amountCents: 50_000,
            receivedOn: today(NYC),
            reference: "chq 2001",
          })
        ).ok,
      ).toBe(true);

      const result = await confirmBooking(president, id);
      expect(result.ok).toBe(true);

      const booking = await getBooking(president, id);
      expect(booking?.status).toEqual("CONFIRMED");
      expect(booking?.confirmedAt).not.toBeNull();
      expect(booking?.checks.every((check) => check.satisfied)).toBe(true);
    });

    it("does not accept a certificate that lapses before the move", async () => {
      // The module's whole reason for existing. The policy is current today and
      // expires the day before the truck arrives; checking against today would
      // wave it through and the building would find out at the door.
      const day = futureDay(13);
      const id = await bookForHal(day);

      await giveHalAValidCertificate(day, { expiresOn: addDays(day, -1) });
      await recordDeposit(president, id, {
        amountCents: 50_000,
        receivedOn: today(NYC),
        reference: "chq 2002",
      });

      const result = await confirmBooking(president, id);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toMatch(/expires|certificate|insurance/i);

      // And the live view says the same thing, so the shareholder can see it
      // without asking.
      const evaluation = await evaluateBooking(shareholder, id);
      expect(evaluation?.satisfied).toBe(false);
    });

    it("does not accept a certificate that does not name the corporation", async () => {
      // The commonest defect in a co-op COI, and the one that makes an
      // otherwise perfect certificate worthless to the building.
      const day = futureDay(14);
      const id = await bookForHal(day);

      await giveHalAValidCertificate(day, { additionalInsuredVerified: false });
      await recordDeposit(president, id, {
        amountCents: 50_000,
        receivedOn: today(NYC),
        reference: "chq 2003",
      });

      const result = await confirmBooking(president, id);
      expect(result.ok).toBe(false);
      expect(!result.ok && result.message).toMatch(/additional insured/i);
    });

    it("cannot be done by the shareholder who asked for it", async () => {
      const id = await bookForHal(futureDay(15));
      await expect(confirmBooking(shareholder, id)).rejects.toBeInstanceOf(
        CapabilityError,
      );
    });

    it("refuses a cancelled booking", async () => {
      const id = await bookForHal(futureDay(16));
      await cancelBooking(shareholder, id, null);

      const result = await confirmBooking(president, id);
      expect(!result.ok && result.code).toEqual("conflict");
    });
  });

  describe("giving the slot up", () => {
    it("lets the apartment release its own", async () => {
      const id = await bookForHal(futureDay(20));
      expect((await cancelBooking(shareholder, id, "Move fell through")).ok).toBe(true);
      expect((await getBooking(shareholder, id))?.status).toEqual("CANCELLED");
    });

    it("does not let a neighbour release somebody else's", async () => {
      const id = await bookForHal(futureDay(21));
      const result = await cancelBooking(neighbour, id, null);
      // Not found rather than forbidden: in a twelve-unit building, "it exists
      // but is not yours" is itself a disclosure.
      expect(!result.ok && result.code).toEqual("not_found");
      expect((await getBooking(shareholder, id))?.status).toEqual("HELD");
    });

    it("lets the board cancel any of them, with a reason on the record", async () => {
      const id = await bookForHal(futureDay(22));
      const result = await cancelBooking(president, id, "Elevator out of service");
      expect(result.ok).toBe(true);

      const booking = await getBooking(shareholder, id);
      expect(booking?.cancelledReason).toEqual("Elevator out of service");
    });
  });

  describe("the deposit", () => {
    it("is recorded on the booking and never on the ledger", async () => {
      // A charge means "this apartment owes us"; a deposit means "we are
      // holding their cheque". Posting the second as the first makes the
      // arrears report wrong, and the arrears report is what a board acts on.
      const id = await bookForHal(futureDay(30));
      const before = await unitLedger(president, halUnit);

      await recordDeposit(president, id, {
        amountCents: 50_000,
        receivedOn: today(NYC),
        reference: "chq 3001",
      });

      const after = await unitLedger(president, halUnit);
      expect(after.charges.length).toEqual(before.charges.length);
      expect(
        balance(ledgerCharges(after.charges), ledgerPayments(after.payments)),
      ).toEqual(
        balance(ledgerCharges(before.charges), ledgerPayments(before.payments)),
      );

      const booking = await getBooking(president, id);
      expect(booking?.depositCents).toEqual(50_000);
      expect(booking?.depositReference).toEqual("chq 3001");
    });

    it("cannot be returned before the move has happened", async () => {
      // A deposit exists to cover what happens during the move. Handing it back
      // in advance is the same as not taking one.
      const id = await bookForHal(futureDay(31));
      await recordDeposit(president, id, {
        amountCents: 50_000,
        receivedOn: today(NYC),
        reference: "chq 3002",
      });

      const result = await returnDeposit(president, id, {
        returnedOn: today(NYC),
        withheldCents: 0,
        note: null,
      });
      expect(!result.ok && result.code).toEqual("conflict");
    });

    it("goes back after a cancellation, because there is nothing left to cover", async () => {
      const id = await bookForHal(futureDay(32));
      await recordDeposit(president, id, {
        amountCents: 50_000,
        receivedOn: today(NYC),
        reference: "chq 3003",
      });
      await cancelBooking(shareholder, id, "Not moving after all");

      const result = await returnDeposit(president, id, {
        returnedOn: today(NYC),
        withheldCents: 0,
        note: null,
      });
      expect(result.ok).toBe(true);

      const booking = await getBooking(president, id);
      // Cancelled stays cancelled — returning the money does not make the move
      // have happened.
      expect(booking?.status).toEqual("CANCELLED");
      expect(booking?.depositReturnedOn).not.toBeNull();
    });

    it("will not be kept back without a reason", async () => {
      const id = await pastBookingForHal(50_000);
      const result = await returnDeposit(president, id, {
        returnedOn: today(NYC),
        withheldCents: 20_000,
        note: null,
      });
      expect(!result.ok && result.code).toEqual("invalid");
    });

    it("will not have more kept back than was taken", async () => {
      // Damage beyond the deposit is a repair the board has to hold somebody
      // responsible for, and that is billed with the determination attached.
      const id = await pastBookingForHal(50_000);
      const result = await returnDeposit(president, id, {
        returnedOn: today(NYC),
        withheldCents: 60_000,
        note: "Scratched the lobby floor",
      });
      expect(!result.ok && result.code).toEqual("invalid");
      expect(!result.ok && result.message).toMatch(/repair|determin/i);
    });

    it("closes the booking out when it goes back", async () => {
      const id = await pastBookingForHal(50_000);
      const result = await returnDeposit(president, id, {
        returnedOn: today(NYC),
        withheldCents: 15_000,
        note: "Gouge in the lobby plaster",
      });
      expect(result.ok).toBe(true);

      const booking = await getBooking(president, id);
      expect(booking?.status).toEqual("COMPLETED");
      expect(booking?.depositWithheldCents).toEqual(15_000);
      expect(booking?.depositNote).toEqual("Gouge in the lobby plaster");
    });

    it("stops counting as held once it has gone back", async () => {
      // The deposit condition asks whether the building is holding the money,
      // not whether it ever did. A returned deposit that still satisfied the
      // check would let a second booking through on the strength of a cheque
      // already posted back.
      const id = await pastBookingForHal(50_000);
      const before = await evaluateBooking(president, id);
      expect(
        before?.outcomes.find((outcome) => outcome.type === "DEPOSIT_PAID")?.satisfied,
      ).toBe(true);

      await returnDeposit(president, id, {
        returnedOn: today(NYC),
        withheldCents: 0,
        note: null,
      });

      const after = await evaluateBooking(president, id);
      expect(
        after?.outcomes.find((outcome) => outcome.type === "DEPOSIT_PAID")?.satisfied,
      ).toBe(false);
    });

    it("cannot be recorded twice by returning and recording again", async () => {
      const id = await pastBookingForHal(50_000);
      await returnDeposit(president, id, {
        returnedOn: today(NYC),
        withheldCents: 0,
        note: null,
      });

      const again = await recordDeposit(president, id, {
        amountCents: 50_000,
        receivedOn: today(NYC),
        reference: "chq 9999",
      });
      expect(!again.ok && again.code).toEqual("conflict");
    });
  });

  describe("what the building schedules", () => {
    it("takes a new thing as a row, conditions and all", async () => {
      // The claim the prerequisite registry was built to make good on: the roof
      // deck arrives as data, with its conditions picked from the same registry
      // the freight elevator uses, and nothing in the checking or the calendar
      // changes to accommodate it.
      const name = `Roof deck ${Date.now().toString(36)}`;
      const created = await addResource(president, {
        name,
        kind: "ROOF_DECK",
        slotMinutes: 180,
        opensMinute: 10 * 60,
        closesMinute: 22 * 60,
        prerequisites: [{ type: "NO_ARREARS", config: { toleranceCents: 0 } }],
      });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      // It books, on its own hours, with four three-hour slots in the day.
      const day = futureDay(40);
      const calendar = await dayCalendar(president, created.data.resourceId, day);
      expect(calendar?.slots).toHaveLength(4);

      const booked = await requestBooking(shareholder, {
        resourceId: created.data.resourceId,
        unitId: halUnit,
        date: day,
        slotIndex: 0,
        slots: 1,
        note: null,
      });
      expect(booked.ok).toBe(true);
      if (!booked.ok) return;

      // And it checks the condition it was given, with no code that knows what
      // a roof deck is.
      const evaluation = await evaluateBooking(president, booked.data.bookingId);
      expect(evaluation?.outcomes.map((outcome) => outcome.type)).toEqual([
        "NO_ARREARS",
      ]);
    });

    it("is not something a shareholder can add", async () => {
      await expect(
        addResource(shareholder, {
          name: "My own private elevator",
          kind: "STORAGE",
          slotMinutes: 60,
          opensMinute: 0,
          closesMinute: 1440,
          prerequisites: [],
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });

    it("refuses hours too short to hold a single slot", async () => {
      const result = await addResource(president, {
        name: `Broom cupboard ${Date.now().toString(36)}`,
        kind: "STORAGE",
        slotMinutes: 240,
        opensMinute: 9 * 60,
        closesMinute: 11 * 60,
        prerequisites: [],
      });
      expect(!result.ok && result.code).toEqual("invalid");
    });

    it("keeps what is already booked when something is retired", async () => {
      // Taking the roof deck off the list is not a decision to cancel the party
      // somebody has already arranged.
      const name = `Courtyard ${Date.now().toString(36)}`;
      const created = await addResource(president, {
        name,
        kind: "COURTYARD",
        slotMinutes: 240,
        opensMinute: 8 * 60,
        closesMinute: 20 * 60,
        prerequisites: [],
      });
      if (!created.ok) throw new Error(created.message);

      const booked = await requestBooking(shareholder, {
        resourceId: created.data.resourceId,
        unitId: halUnit,
        date: futureDay(41),
        slotIndex: 0,
        slots: 1,
        note: null,
      });
      if (!booked.ok) throw new Error(booked.message);

      expect((await retireResource(president, created.data.resourceId)).ok).toBe(true);

      // Gone from the list, and the booking stands.
      const resources = await listResources(president);
      expect(resources.map((resource) => resource.name)).not.toContain(name);
      expect((await getBooking(shareholder, booked.data.bookingId))?.status).toEqual(
        "HELD",
      );

      // But nothing new goes on it.
      const again = await requestBooking(shareholder, {
        resourceId: created.data.resourceId,
        unitId: halUnit,
        date: futureDay(42),
        slotIndex: 0,
        slots: 1,
        note: null,
      });
      expect(!again.ok && again.code).toEqual("conflict");
    });
  });

  describe("what a neighbour may see", () => {
    it("shows that the slot is taken, and by whom", async () => {
      // A calendar that hides its bookings is not a calendar. Somebody planning
      // their own move has to see that Saturday morning is gone.
      const day = futureDay(50);
      await bookForHal(day);

      const calendar = await dayCalendar(neighbour, elevatorId, day);
      const taken = calendar?.slots.find((slot) => slot.takenBy);
      expect(taken?.takenBy?.unitLabel).toEqual("GARDEN");
    });

    it("does not show a neighbour the note, the deposit or the checks", async () => {
      const day = futureDay(51);
      const id = await bookForHal(day);
      await recordDeposit(president, id, {
        amountCents: 50_000,
        receivedOn: today(NYC),
        reference: "chq 4001",
      });
      await confirmBooking(president, id);

      const asNeighbour = await getBooking(neighbour, id);
      expect(asNeighbour?.detailed).toBe(false);
      expect(asNeighbour?.note).toBeNull();
      expect(asNeighbour?.depositCents).toBeNull();
      expect(asNeighbour?.depositReference).toBeNull();
      expect(asNeighbour?.checks).toEqual([]);

      // The apartment itself sees all of it.
      const asHal = await getBooking(shareholder, id);
      expect(asHal?.detailed).toBe(true);
      expect(asHal?.depositCents).toEqual(50_000);
      expect(asHal?.note).toBeTruthy();
    });

    it("blanks the same fields in the list, not only on the detail page", async () => {
      const day = futureDay(52);
      const id = await bookForHal(day);
      await recordDeposit(president, id, {
        amountCents: 50_000,
        receivedOn: today(NYC),
        reference: "chq 4002",
      });

      const listed = (await listBookings(neighbour)).find((row) => row.id === id);
      expect(listed).toBeDefined();
      expect(listed?.depositCents).toBeNull();
      expect(listed?.note).toBeNull();
    });

    it("will not evaluate a neighbour's conditions for them", async () => {
      const id = await bookForHal(futureDay(53));
      expect(await evaluateBooking(neighbour, id)).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Fixtures
  // -------------------------------------------------------------------------

  /**
   * Files a mover's certificate for the garden apartment covering a date.
   *
   * Written straight to the table rather than through the certificates module,
   * because what is under test here is the booking check reading it, not the
   * COI module writing it.
   */
  async function giveHalAValidCertificate(
    day: PlainDate,
    overrides: {
      expiresOn?: PlainDate;
      additionalInsuredVerified?: boolean;
    } = {},
  ): Promise<void> {
    await withBuildingTx(president.building.id, async (tx) => {
      // One certificate at a time, so a previous test's does not answer for
      // this one.
      await tx.certificateOfInsurance.deleteMany({
        where: { unitId: halUnit, holderKind: "MOVER" },
      });
      await tx.certificateOfInsurance.create({
        data: {
          buildingId: president.building.id,
          holderKind: "MOVER",
          holderName: "Vanguard Moving & Storage",
          unitId: halUnit,
          carrier: "Travelers",
          policyNumber: `CMP-${Date.now()}`,
          coverageCents: 200_000_000,
          effectiveOn: toDbDate(addDays(today(NYC), -30)),
          expiresOn: toDbDate(overrides.expiresOn ?? addDays(day, 30)),
          additionalInsuredVerified: overrides.additionalInsuredVerified ?? true,
        },
      });
    });
  }

  /**
   * A booking that has already been and gone, with a deposit on it.
   *
   * Written directly because the write path refuses a slot in the past —
   * correctly — and the deposit return path needs one that has happened.
   */
  async function pastBookingForHal(depositCents: number): Promise<string> {
    return withBuildingTx(president.building.id, async (tx) => {
      const day = addDays(today(NYC), -400 - Math.floor(Math.random() * 2000));
      const booking = await tx.booking.create({
        data: {
          buildingId: president.building.id,
          resourceId: elevatorId,
          unitId: halUnit,
          requestedById: shareholder.membership.id,
          startsAt: instantAt(day, "08:00:00", NYC),
          endsAt: instantAt(day, "12:00:00", NYC),
          status: "CONFIRMED",
          depositCents,
          depositReceivedOn: toDbDate(addDays(day, -3)),
          depositReference: "chq 0001",
        },
        select: { id: true },
      });
      return booking.id;
    });
  }
});

/** Narrows Prisma's rows to what the ledger primitive wants. */
function ledgerCharges(
  charges: Array<{
    id: string;
    unitId: string;
    amountCents: number;
    dueOn: Date;
    reversesChargeId: string | null;
  }>,
) {
  return charges.map((charge) => ({
    ...charge,
    dueOn: toPlainDateish(charge.dueOn),
  }));
}

function ledgerPayments(
  payments: Array<{
    id: string;
    unitId: string;
    amountCents: number;
    receivedOn: Date;
    reversesPaymentId: string | null;
  }>,
) {
  return payments.map((payment) => ({
    ...payment,
    receivedOn: toPlainDateish(payment.receivedOn),
  }));
}

function toPlainDateish(value: Date): PlainDate {
  return value.toISOString().slice(0, 10) as PlainDate;
}
