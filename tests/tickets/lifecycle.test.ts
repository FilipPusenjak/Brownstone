import { beforeAll, describe, expect, it } from "vitest";
import { CapabilityError } from "~/lib/auth/capabilities";
import type { BuildingContext } from "~/lib/db/context";
import { unitLedger } from "~/lib/db/scoped/ledger";
import { getTicket, listTickets, liveCharges } from "~/lib/db/scoped/tickets";
import {
  chargeTicketToUnit,
  commentOnTicket,
  decideResponsibility,
  openDetermination,
  reportTicket,
  resolveTicket,
  setTicketStatus,
  triageTicket,
} from "~/lib/db/scoped/ticket-writes";
import { listUnitsWithShares } from "~/lib/db/scoped/units";
import { expect as unwrap } from "~/lib/result";
import { makeDate } from "~/lib/time";
import { ADELAIDE, LISPENARD, PEOPLE, contextFor } from "../helpers/context";

/**
 * Repair tickets, and the bill that sometimes follows one.
 *
 * The claim under test is the one a shareholder cares about: nobody can put a
 * repair on my ledger until the board has said, in writing and under a name,
 * that it is mine to pay for. Everything else here — triage, resolution, the
 * comment thread — is bookkeeping around that one rule.
 *
 * The other claim is quieter and matters as much: a repair in my apartment is
 * mine and my neighbour cannot read it, while a repair to the front door is
 * everyone's.
 */

describe("repair tickets", () => {
  let president: BuildingContext;
  let treasurer: BuildingContext;
  let hal: BuildingContext; // shareholder, garden apartment
  let marta: BuildingContext; // shareholder, 2R
  let sal: BuildingContext; // the super
  let otherBuilding: BuildingContext;

  let garden: string;
  let twoR: string;

  beforeAll(async () => {
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    treasurer = await contextFor(PEOPLE.desmondTreasurer, ADELAIDE);
    hal = await contextFor(PEOPLE.halShareholder, ADELAIDE);
    marta = await contextFor(PEOPLE.martaBoth, ADELAIDE);
    sal = await contextFor(PEOPLE.salSuper, ADELAIDE);
    otherBuilding = await contextFor(PEOPLE.ivanPresident, LISPENARD);

    const units = await listUnitsWithShares(president);
    garden = units.find((u) => u.label === "GARDEN")!.id;
    twoR = units.find((u) => u.label === "2R")!.id;
  });

  /** A ticket in Hal's apartment, reported by Hal. */
  async function halsTicket(title = "Radiator knocking overnight"): Promise<string> {
    return unwrap(
      await reportTicket(hal, {
        title,
        detail: "Started last week, loud enough to wake the whole floor.",
        unitId: garden,
      }),
    ).ticketId;
  }

  describe("reporting", () => {
    it("lets a shareholder report something in their own apartment", async () => {
      const ticketId = await halsTicket();

      const ticket = await getTicket(hal, ticketId);
      expect(ticket?.status).toEqual("OPEN");
      expect(ticket?.priority).toEqual("NORMAL");
      // Nobody has decided anything yet, and the record says so rather than
      // defaulting to somebody's advantage.
      expect(ticket?.responsibility).toEqual("UNDETERMINED");
      expect(ticket?.unit?.label).toEqual("GARDEN");
    });

    it("lets anyone report something shared, with no apartment attached", async () => {
      const result = await reportTicket(hal, {
        title: "Front door latch not catching",
        detail: "It looks shut but pushes open. Anyone can walk in.",
        area: "Vestibule",
        priority: "URGENT",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const ticket = await getTicket(hal, result.data.ticketId);
      expect(ticket?.unitId).toBeNull();
      expect(ticket?.area).toEqual("Vestibule");
    });

    it("refuses a shareholder reporting one against a neighbour's apartment", async () => {
      const result = await reportTicket(hal, {
        title: "Their bathroom is leaking into mine",
        detail: "There is a stain on my ceiling under 2R's bathroom.",
        unitId: twoR,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("forbidden");
    });

    it("lets an officer file on a neighbour's behalf", async () => {
      // The super typing up a phone call is the normal case in these buildings.
      const result = await reportTicket(president, {
        title: "Window sash cord snapped",
        detail: "Reported by phone. The front window will not stay up.",
        unitId: twoR,
      });

      expect(result.ok).toBe(true);
    });

    it("asks for enough detail to be worth reading", async () => {
      const result = await reportTicket(hal, {
        title: "Broken",
        detail: "bad",
        unitId: garden,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("invalid");
    });
  });

  describe("who can see it", () => {
    it("keeps a repair in one apartment away from the neighbours", async () => {
      const ticketId = await halsTicket("Leak under the garden sink");

      expect(await getTicket(hal, ticketId)).not.toBeNull();
      expect(await getTicket(president, ticketId)).not.toBeNull();
      // Marta holds 2R. This is none of her business.
      expect(await getTicket(marta, ticketId)).toBeNull();

      const hers = await listTickets(marta);
      expect(hers.map((t) => t.id)).not.toContain(ticketId);
    });

    it("shows a shared repair to everyone", async () => {
      const result = unwrap(
        await reportTicket(president, {
          title: "Stoop handrail loose",
          detail: "The bottom bracket has pulled out of the brownstone.",
        }),
      );

      expect(await getTicket(marta, result.ticketId)).not.toBeNull();
      expect(await getTicket(hal, result.ticketId)).not.toBeNull();
    });

    it("keeps one building's repairs out of another's", async () => {
      const ticketId = await halsTicket("Buzzer not working");
      expect(await getTicket(otherBuilding, ticketId)).toBeNull();
    });
  });

  describe("triage", () => {
    it("hands it to the super and moves it along", async () => {
      const ticketId = await halsTicket();
      const salMembership = (await listTickets(president)).find(
        (t) => t.id === ticketId,
      );
      expect(salMembership).toBeDefined();

      unwrap(
        await triageTicket(president, ticketId, {
          vendorName: "Brennan Plumbing",
          vendorPhone: "718-555-0148",
          priority: "URGENT",
        }),
      );

      const ticket = await getTicket(president, ticketId);
      expect(ticket?.status).toEqual("TRIAGED");
      expect(ticket?.vendorName).toEqual("Brennan Plumbing");
      expect(ticket?.priority).toEqual("URGENT");
      expect(ticket?.triagedAt).not.toBeNull();
    });

    it("refuses a plain shareholder", async () => {
      const ticketId = await halsTicket();
      await expect(
        triageTicket(hal, ticketId, { priority: "EMERGENCY" }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });

    it("lets the super triage, because that is the job", async () => {
      const ticketId = unwrap(
        await reportTicket(president, {
          title: "Boiler pressure dropping",
          detail: "Needs topping up every few days, which it did not use to.",
        }),
      ).ticketId;

      const result = await triageTicket(sal, ticketId, { priority: "URGENT" });
      expect(result.ok).toBe(true);
    });

    it("will not drag a resolved repair backwards", async () => {
      const ticketId = await halsTicket();
      unwrap(await triageTicket(president, ticketId, { priority: "NORMAL" }));
      unwrap(await resolveTicket(president, ticketId, { note: "Bled the radiator." }));

      unwrap(await triageTicket(president, ticketId, { vendorName: "Someone else" }));

      const ticket = await getTicket(president, ticketId);
      expect(ticket?.status).toEqual("RESOLVED");
    });

    it("does not insist on triage before a five-minute fix", async () => {
      const ticketId = await halsTicket();

      // Straight from reported to fixed. The super who tightens a handrail the
      // same afternoon should not have to record that he considered it first.
      const result = await resolveTicket(president, ticketId, {
        note: "Tightened the bracket.",
      });
      expect(result.ok).toBe(true);
    });

    it("refuses a status move backwards", async () => {
      const ticketId = await halsTicket();
      unwrap(await resolveTicket(president, ticketId, { note: "Bled the radiator." }));
      unwrap(await setTicketStatus(president, ticketId, "CLOSED"));

      // A closed repair has to be reopened before it can be resolved again.
      const result = await setTicketStatus(president, ticketId, "RESOLVED");
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("conflict");
    });

    it("lets a fault that came back reopen the same repair", async () => {
      const ticketId = await halsTicket();
      unwrap(await setTicketStatus(president, ticketId, "IN_PROGRESS"));
      unwrap(
        await resolveTicket(president, ticketId, { note: "Replaced the flush valve." }),
      );
      expect((await getTicket(president, ticketId))?.resolvedAt).not.toBeNull();

      unwrap(await setTicketStatus(president, ticketId, "IN_PROGRESS"));

      const ticket = await getTicket(president, ticketId);
      expect(ticket?.status).toEqual("IN_PROGRESS");
      // A fault that came back was not resolved, and the record should not
      // claim it was.
      expect(ticket?.resolvedAt).toBeNull();
      // The account of what was tried survives, which is the point of reopening
      // rather than filing a second ticket.
      expect(ticket?.resolutionNote).toEqual("Replaced the flush valve.");
    });
  });

  describe("resolution", () => {
    it("records what was done and what it cost", async () => {
      const ticketId = await halsTicket();
      unwrap(await triageTicket(president, ticketId, {}));

      unwrap(
        await resolveTicket(president, ticketId, {
          note: "Replaced the flush valve, not the whole tank.",
          costCents: 35_000,
        }),
      );

      const ticket = await getTicket(president, ticketId);
      expect(ticket?.status).toEqual("RESOLVED");
      expect(ticket?.costCents).toEqual(35_000);
      expect(ticket?.resolutionNote).toMatch(/flush valve/);
      expect(ticket?.resolvedBy?.user.email).toEqual(PEOPLE.noraPresident);
    });

    it("insists on saying what was done", async () => {
      const ticketId = await halsTicket();
      unwrap(await triageTicket(president, ticketId, {}));

      const result = await resolveTicket(president, ticketId, { note: "ok" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("invalid");
    });
  });

  describe("who pays", () => {
    it("lets the shareholder put the question to the board themselves", async () => {
      const ticketId = await halsTicket();

      const result = await openDetermination(hal, ticketId, {
        question: "The pipe is behind the wall, so I think this is the co-op's.",
      });

      expect(result.ok).toBe(true);
      const ticket = await getTicket(hal, ticketId);
      expect(ticket?.approval?.status).toEqual("SUBMITTED");
      expect(ticket?.comments).toHaveLength(1);
    });

    it("records the answer with a name on it", async () => {
      const ticketId = await halsTicket();
      unwrap(await openDetermination(hal, ticketId));

      unwrap(
        await decideResponsibility(president, ticketId, {
          action: "approve",
          responsibility: "SHAREHOLDER",
          note: "Fixture inside the apartment. Paragraph 18 of the lease.",
        }),
      );

      const ticket = await getTicket(hal, ticketId);
      expect(ticket?.responsibility).toEqual("SHAREHOLDER");
      expect(ticket?.approval?.status).toEqual("APPROVED");
      expect(ticket?.approval?.decidedBy?.user.email).toEqual(PEOPLE.noraPresident);
      expect(ticket?.approval?.decisionNote).toMatch(/Paragraph 18/);
    });

    it("refuses to approve without naming who pays", async () => {
      const ticketId = await halsTicket();
      unwrap(await openDetermination(hal, ticketId));

      const result = await decideResponsibility(president, ticketId, {
        action: "approve",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("invalid");
      expect((await getTicket(hal, ticketId))?.responsibility).toEqual("UNDETERMINED");
    });

    it("refuses a plain shareholder deciding it", async () => {
      const ticketId = await halsTicket();
      unwrap(await openDetermination(hal, ticketId));

      const result = await decideResponsibility(hal, ticketId, {
        action: "approve",
        responsibility: "COOPERATIVE",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("conflict");
    });

    it("will not let a decided determination be rewritten", async () => {
      const ticketId = await halsTicket();
      unwrap(await openDetermination(hal, ticketId));
      unwrap(
        await decideResponsibility(president, ticketId, {
          action: "approve",
          responsibility: "COOPERATIVE",
        }),
      );

      const second = await decideResponsibility(president, ticketId, {
        action: "approve",
        responsibility: "SHAREHOLDER",
      });

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.code).toEqual("conflict");
      expect((await getTicket(hal, ticketId))?.responsibility).toEqual("COOPERATIVE");
    });

    it("offers no way to deny the question", async () => {
      const ticketId = await halsTicket();
      unwrap(await openDetermination(hal, ticketId));

      const result = await decideResponsibility(president, ticketId, {
        action: "deny",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      // Every repair has someone responsible for it; denying would leave the
      // question open while looking settled.
      expect(result.message).toMatch(/always has someone responsible/);
    });

    it("cannot make a shared repair the shareholder's", async () => {
      const ticketId = unwrap(
        await reportTicket(president, {
          title: "Stoop light out",
          detail: "The fixture over the front steps has stopped working.",
        }),
      ).ticketId;
      unwrap(await openDetermination(president, ticketId));

      const result = await decideResponsibility(president, ticketId, {
        action: "approve",
        responsibility: "SHAREHOLDER",
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("invalid");
    });

    it("keeps the board's private thread away from the shareholder", async () => {
      const ticketId = await halsTicket();
      unwrap(await openDetermination(hal, ticketId));

      unwrap(
        await commentOnTicket(hal, ticketId, {
          body: "I think this one is the co-op's.",
        }),
      );
      unwrap(
        await commentOnTicket(president, ticketId, {
          body: "He has asked for three of these this year.",
          boardOnly: true,
        }),
      );

      const boardsView = await getTicket(president, ticketId);
      expect(boardsView?.comments).toHaveLength(2);

      const halsView = await getTicket(hal, ticketId);
      expect(halsView?.comments).toHaveLength(1);
      expect(halsView?.comments.map((c) => c.body).join(" ")).not.toMatch(
        /three of these/,
      );
    });

    it("refuses a shareholder posting into the private thread", async () => {
      const ticketId = await halsTicket();
      unwrap(await openDetermination(hal, ticketId));

      await expect(
        commentOnTicket(hal, ticketId, { body: "sneaking in", boardOnly: true }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });
  });

  describe("the bill", () => {
    const DUE = makeDate(2027, 6, 1);

    it("refuses to bill an apartment before the board has decided", async () => {
      const ticketId = await halsTicket();
      unwrap(await resolveTicketVia(president, ticketId));

      const result = await chargeTicketToUnit(treasurer, ticketId, {
        amountCents: 35_000,
        dueOn: DUE,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("conflict");
      expect(result.message).toMatch(/hasn't determined who pays/);
    });

    it("refuses to bill when the board said the co-op pays", async () => {
      const ticketId = await halsTicket();
      unwrap(await openDetermination(hal, ticketId));
      unwrap(
        await decideResponsibility(president, ticketId, {
          action: "approve",
          responsibility: "COOPERATIVE",
        }),
      );

      const result = await chargeTicketToUnit(treasurer, ticketId, {
        amountCents: 35_000,
        dueOn: DUE,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/corporation's/);
    });

    it("bills the apartment once the determination says so, and it lands on the ledger", async () => {
      const ticketId = await halsTicket("Kitchen tap seized");
      unwrap(await openDetermination(hal, ticketId));
      unwrap(
        await decideResponsibility(president, ticketId, {
          action: "approve",
          responsibility: "SHAREHOLDER",
          note: "Fixture inside the apartment.",
        }),
      );
      unwrap(
        await resolveTicket(president, ticketId, {
          note: "New tap fitted.",
          costCents: 28_500,
        }),
      );

      const charged = unwrap(
        await chargeTicketToUnit(treasurer, ticketId, {
          amountCents: 28_500,
          dueOn: DUE,
        }),
      );

      const ticket = await getTicket(treasurer, ticketId);
      expect(liveCharges(ticket!.charges)).toHaveLength(1);
      expect(liveCharges(ticket!.charges)[0]?.amountCents).toEqual(28_500);

      // And it is real money on the real ledger, not a number on this page.
      const ledger = await unitLedger(treasurer, garden);
      const posted = ledger.charges.find((c) => c.id === charged.chargeId);
      expect(posted?.amountCents).toEqual(28_500);
      expect(posted?.memo).toMatch(/Kitchen tap seized/);
    });

    it("refuses to bill twice", async () => {
      const ticketId = await halsTicket("Doorbell transformer");
      unwrap(await openDetermination(hal, ticketId));
      unwrap(
        await decideResponsibility(president, ticketId, {
          action: "approve",
          responsibility: "SHAREHOLDER",
        }),
      );
      unwrap(
        await chargeTicketToUnit(treasurer, ticketId, {
          amountCents: 12_000,
          dueOn: DUE,
        }),
      );

      const second = await chargeTicketToUnit(treasurer, ticketId, {
        amountCents: 12_000,
        dueOn: DUE,
      });

      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.message).toMatch(/already been billed/);
    });

    it("refuses an officer who is not the treasurer", async () => {
      const ticketId = await halsTicket();
      unwrap(await openDetermination(hal, ticketId));
      unwrap(
        await decideResponsibility(president, ticketId, {
          action: "approve",
          responsibility: "SHAREHOLDER",
        }),
      );

      // The president can decide who pays. Putting it on a ledger is the
      // treasurer's alone.
      await expect(
        chargeTicketToUnit(president, ticketId, {
          amountCents: 12_000,
          dueOn: DUE,
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });

    it("refuses to bill a repair with no apartment behind it", async () => {
      const ticketId = unwrap(
        await reportTicket(president, {
          title: "Gutter overflowing",
          detail: "Water is coming down the front of the building in heavy rain.",
        }),
      ).ticketId;

      const result = await chargeTicketToUnit(treasurer, ticketId, {
        amountCents: 20_000,
        dueOn: DUE,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/nobody to bill/);
    });
  });

  /** Triage then resolve, for tests that only care about the end state. */
  async function resolveTicketVia(
    ctx: BuildingContext,
    ticketId: string,
  ): Promise<ReturnType<typeof resolveTicket>> {
    unwrap(await triageTicket(ctx, ticketId, {}));
    return resolveTicket(ctx, ticketId, { note: "Done.", costCents: 35_000 });
  }
});
