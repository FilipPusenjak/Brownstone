import { beforeAll, describe, expect, it } from "vitest";
import { CapabilityError } from "~/lib/auth/capabilities";
import type { BuildingContext } from "~/lib/db/context";
import {
  closeCampaign,
  openCampaign,
  recordDelivery,
  recordResponse,
  sendCampaign,
} from "~/lib/db/scoped/notice-writes";
import { getCampaign, listCampaigns, noticeLog } from "~/lib/db/scoped/notices";
import { withBuildingTx } from "~/lib/db/tx";
import { addDays, plainDate, today, type PlainDate } from "~/lib/time";
import { ADELAIDE, PEOPLE, contextFor } from "../helpers/context";

/**
 * The annual notices, against the real database.
 *
 * One rule carries the file: **an apartment that never replied is not an
 * apartment that said no.** Closing a campaign is the act that says so — it
 * converts every silence into a follow-up on the compliance calendar with the
 * reason written on it, and it refuses to run while a household still has time
 * to answer or while any apartment was never written to at all.
 *
 * The rest of the tests exist to stop that one from becoming vacuous: that
 * sending twice does not mail anybody twice, that the log keeps what was sent
 * verbatim, and that a neighbour cannot read which apartment has a child in it.
 */

/** A campaign whose reply-by date has already passed, whatever today is. */
function pastWindow(): { dueOn: PlainDate; respondBy: PlainDate } {
  const now = today();
  return { dueOn: addDays(now, -60), respondBy: addDays(now, -30) };
}

/** A campaign households can still answer. */
function openWindow(): { dueOn: PlainDate; respondBy: PlainDate } {
  const now = today();
  return { dueOn: addDays(now, -1), respondBy: addDays(now, 29) };
}

describe("annual notices", () => {
  let president: BuildingContext;
  let shareholder: BuildingContext; // Hal, GARDEN
  let neighbour: BuildingContext; // Marta, 2R
  let year = 2050;

  beforeAll(async () => {
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    shareholder = await contextFor(PEOPLE.halShareholder, ADELAIDE);
    neighbour = await contextFor(PEOPLE.martaBoth, ADELAIDE);
  });

  /** A fresh year per campaign, since one per (type, year) is the rule. */
  function nextYear(): number {
    year += 1;
    return year;
  }

  async function open(
    window: { dueOn: PlainDate; respondBy: PlainDate } = pastWindow(),
  ): Promise<string> {
    const result = await openCampaign(president, {
      noticeType: "WINDOW_GUARD",
      year: nextYear(),
      dueOn: window.dueOn,
      respondBy: window.respondBy,
    });
    if (!result.ok) throw new Error(`${result.code}: ${result.message}`);
    return result.data.campaignId;
  }

  /**
   * Takes one apartment's address off its delivery row.
   *
   * Every apartment in the seed happens to have a member with an email, which
   * makes the "nobody to write to" path unreachable — and a test that never
   * reaches it passes for the wrong reason. Written directly, because what is
   * under test is what sending does about a missing address, not how the
   * address came to be missing.
   */
  async function loseTheAddressFor(
    campaignId: string,
    unitLabel: string,
  ): Promise<string> {
    const campaign = await getCampaign(president, campaignId);
    const row = campaign!.deliveries.find((d) => d.unitLabel === unitLabel)!;
    await withBuildingTx(president.building.id, (tx) =>
      tx.noticeDelivery.update({
        where: { id: row.id },
        data: { recipientEmail: null },
      }),
    );
    return row.unitLabel;
  }

  /** Marks every delivery as having gone out, without touching the mailer. */
  async function deliverAllByHand(campaignId: string): Promise<void> {
    const campaign = await getCampaign(president, campaignId);
    for (const delivery of campaign!.deliveries) {
      const result = await recordDelivery(president, delivery.id, {
        method: "HAND",
        sentOn: today(),
        documentId: null,
      });
      if (!result.ok) throw new Error(result.message);
    }
  }

  describe("opening one", () => {
    it("lists every apartment before anything is sent", async () => {
      // Who must be written to is a fact about the building, not a by-product
      // of who happened to have an address on file that morning.
      const campaignId = await open();
      const campaign = await getCampaign(president, campaignId);

      expect(campaign?.deliveries).toHaveLength(6);
      expect(campaign?.standing.notSent).toEqual(6);
      expect(campaign?.standing.everyoneHeard).toBe(false);
    });

    it("addresses each one to the name on the stock certificate", async () => {
      const campaignId = await open();
      const campaign = await getCampaign(president, campaignId);
      const garden = campaign?.deliveries.find((row) => row.unitLabel === "GARDEN");

      expect(garden?.recipientName).toEqual("Hal Brenner");
    });

    it("refuses a second campaign for the same notice and year", async () => {
      const thisYear = nextYear();
      const first = await openCampaign(president, {
        noticeType: "WINDOW_GUARD",
        year: thisYear,
        dueOn: addDays(today(), -60),
        respondBy: addDays(today(), -30),
      });
      expect(first.ok).toBe(true);

      const second = await openCampaign(president, {
        noticeType: "WINDOW_GUARD",
        year: thisYear,
        dueOn: addDays(today(), -60),
        respondBy: addDays(today(), -30),
      });
      expect(!second.ok && second.code).toEqual("conflict");
    });

    it("refuses a reply-by date before the notice goes out", async () => {
      const result = await openCampaign(president, {
        noticeType: "WINDOW_GUARD",
        year: nextYear(),
        dueOn: plainDate("2060-01-15"),
        respondBy: plainDate("2060-01-01"),
      });
      expect(!result.ok && result.code).toEqual("invalid");
    });

    it("is not something a shareholder can do", async () => {
      await expect(
        openCampaign(shareholder, {
          noticeType: "WINDOW_GUARD",
          year: nextYear(),
          dueOn: today(),
          respondBy: addDays(today(), 30),
        }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });
  });

  describe("sending it", () => {
    it("writes down what was sent, verbatim, and to which address", async () => {
      // The artefact a building produces when somebody says they never got it.
      const campaignId = await open();
      const sent = await sendCampaign(president, campaignId);
      expect(sent.ok).toBe(true);

      const log = await noticeLog(president, campaignId);
      expect(log.length).toBeGreaterThan(0);

      const entry = log[0]!;
      expect(entry.recipientEmail).toContain("@");
      expect(entry.subject).toMatch(/Window guard/i);
      // The notice itself, not HTML with the tags taken out.
      expect(entry.textBody).toMatch(/child ten years old or younger/);
      expect(entry.textBody).toMatch(/If we hear nothing from you/);
    });

    it("does not mail a household twice", async () => {
      // A second press of the button, or a retried action. A building that
      // double-sends its January notices teaches twelve people to ignore its
      // email, and after that the notices stop working at all.
      const campaignId = await open();
      const first = await sendCampaign(president, campaignId);
      const second = await sendCampaign(president, campaignId);

      expect(first.ok && first.data.sent).toBeGreaterThan(0);
      expect(second.ok && second.data.sent).toEqual(0);

      const log = await noticeLog(president, campaignId);
      const addresses = log.map((row) => row.recipientEmail);
      expect(new Set(addresses).size).toEqual(addresses.length);
    });

    it("leaves an apartment with no address unsent, and says so", async () => {
      // An estate, an LLC, a shareholder who has never given the board an
      // address. That apartment is not sent anything and must not be recorded
      // as though it were — it is the one somebody has to walk a copy to.
      const campaignId = await open();
      const label = await loseTheAddressFor(campaignId, "4F");
      expect(label).toEqual("4F");

      const result = await sendCampaign(president, campaignId);
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      expect(result.data.noAddress).toEqual(1);
      expect(result.data.sent).toEqual(5);

      const campaign = await getCampaign(president, campaignId);
      const unsent = campaign!.deliveries.filter((row) => !row.sentAt);
      expect(unsent.map((row) => row.unitLabel)).toEqual(["4F"]);
      expect(campaign!.standing.everyoneHeard).toBe(false);
    });

    it("records a paper copy put under the door", async () => {
      const campaignId = await open();
      await loseTheAddressFor(campaignId, "4F");
      await sendCampaign(president, campaignId);

      const before = await getCampaign(president, campaignId);
      const missed = before!.deliveries.find((row) => !row.sentAt)!;
      expect(missed.unitLabel).toEqual("4F");

      const result = await recordDelivery(president, missed.id, {
        method: "HAND",
        sentOn: today(),
        documentId: null,
      });
      expect(result.ok).toBe(true);

      const after = await getCampaign(president, campaignId);
      expect(after!.standing.everyoneHeard).toBe(true);
      expect(after!.deliveries.find((row) => row.id === missed.id)?.method).toEqual(
        "HAND",
      );
    });

    it("does not mail a household twice even from two presses at once", async () => {
      // The `sentAt` filter stops the ordinary second press. It cannot stop two
      // requests that both read the row before either wrote to it — the dedupe
      // key is what does that, and this reproduces the race by putting the row
      // back the way both of them would have found it.
      const campaignId = await open();
      await sendCampaign(president, campaignId);
      const first = await noticeLog(president, campaignId);

      await withBuildingTx(president.building.id, (tx) =>
        tx.noticeDelivery.updateMany({
          where: { campaignId },
          data: { sentAt: null, notificationId: null },
        }),
      );

      const again = await sendCampaign(president, campaignId);
      expect(again.ok && again.data.sent).toEqual(0);
      expect(again.ok && again.data.duplicates).toBeGreaterThan(0);

      // Nothing new reached the log, and nobody got a second copy.
      expect(await noticeLog(president, campaignId)).toHaveLength(first.length);
    });

    it("will not let email be recorded by hand", async () => {
      // Otherwise a row could claim an email went out with nothing in the log
      // to show for it, which is the one thing the log exists to prevent.
      const campaignId = await open();
      const campaign = await getCampaign(president, campaignId);

      const result = await recordDelivery(president, campaign!.deliveries[0]!.id, {
        method: "EMAIL",
        sentOn: today(),
        documentId: null,
      });
      expect(!result.ok && result.code).toEqual("invalid");
    });
  });

  describe("what comes back", () => {
    it("puts the work on the calendar when a household says yes", async () => {
      const campaignId = await open();
      await deliverAllByHand(campaignId);

      const campaign = await getCampaign(president, campaignId);
      const garden = campaign!.deliveries.find((row) => row.unitLabel === "GARDEN")!;

      const result = await recordResponse(president, garden.id, {
        answer: "YES",
        note: "Two children, 4 and 7.",
        respondedOn: today(),
        documentId: null,
      });
      expect(result.ok && result.data.owedWork).toBe(true);

      const after = await getCampaign(president, campaignId);
      const row = after!.deliveries.find((d) => d.id === garden.id)!;
      expect(row.reason).toEqual("answered-yes");
      expect(row.obligationId).not.toBeNull();

      const obligation = await withBuildingTx(president.building.id, (tx) =>
        tx.obligation.findUnique({
          where: { id: row.obligationId! },
          select: { kind: true, title: true, detail: true, state: true },
        }),
      );
      expect(obligation?.kind).toEqual("NOTICE");
      expect(obligation?.title).toContain("GARDEN");
      expect(obligation?.title).toMatch(/window guards/i);
      expect(obligation?.state).toEqual("OPEN");
    });

    it("puts it on the calendar for somebody who just wants them", async () => {
      // No child in the apartment, and the building still owes the guards.
      // Folding this into "no" would lose the obligation entirely.
      const campaignId = await open();
      await deliverAllByHand(campaignId);

      const campaign = await getCampaign(president, campaignId);
      const row = campaign!.deliveries[0]!;

      const result = await recordResponse(president, row.id, {
        answer: "REQUESTED",
        note: null,
        respondedOn: today(),
        documentId: null,
      });
      expect(result.ok && result.data.owedWork).toBe(true);
    });

    it("puts nothing on the calendar for a no", async () => {
      const campaignId = await open();
      await deliverAllByHand(campaignId);

      const campaign = await getCampaign(president, campaignId);
      const row = campaign!.deliveries[0]!;

      const result = await recordResponse(president, row.id, {
        answer: "NO",
        note: null,
        respondedOn: today(),
        documentId: null,
      });
      expect(result.ok && result.data.owedWork).toBe(false);

      const after = await getCampaign(president, campaignId);
      expect(after!.deliveries.find((d) => d.id === row.id)?.obligationId).toBeNull();
    });

    it("lets a shareholder answer for their own apartment", async () => {
      const campaignId = await open();
      await deliverAllByHand(campaignId);

      const campaign = await getCampaign(president, campaignId);
      const garden = campaign!.deliveries.find((row) => row.unitLabel === "GARDEN")!;

      const result = await recordResponse(shareholder, garden.id, {
        answer: "NO",
        note: null,
        respondedOn: today(),
        documentId: null,
      });
      expect(result.ok).toBe(true);
    });

    it("does not let them answer for a neighbour's", async () => {
      const campaignId = await open();
      await deliverAllByHand(campaignId);

      const campaign = await getCampaign(president, campaignId);
      const garden = campaign!.deliveries.find((row) => row.unitLabel === "GARDEN")!;

      const result = await recordResponse(neighbour, garden.id, {
        answer: "NO",
        note: null,
        respondedOn: today(),
        documentId: null,
      });
      expect(!result.ok && result.code).toEqual("not_found");
    });

    it("refuses an answer to a notice that never went out", async () => {
      const campaignId = await open();
      const campaign = await getCampaign(president, campaignId);

      const result = await recordResponse(president, campaign!.deliveries[0]!.id, {
        answer: "NO",
        note: null,
        respondedOn: today(),
        documentId: null,
      });
      expect(!result.ok && result.code).toEqual("conflict");
    });
  });

  describe("closing it out", () => {
    it("turns every silence into work on the calendar", async () => {
      // The module in one test. Six apartments, one answers no, five say
      // nothing — and five follow-ups appear, each carrying the reason.
      const campaignId = await open();
      await deliverAllByHand(campaignId);

      const before = await getCampaign(president, campaignId);
      await recordResponse(president, before!.deliveries[0]!.id, {
        answer: "NO",
        note: null,
        respondedOn: today(),
        documentId: null,
      });

      const closed = await closeCampaign(president, campaignId);
      expect(closed.ok && closed.data.followUps).toEqual(5);

      const after = await getCampaign(president, campaignId);
      expect(after!.closedAt).not.toBeNull();

      const silent = after!.deliveries.filter((row) => row.respondedAt === null);
      expect(silent).toHaveLength(5);
      for (const row of silent) {
        expect(row.reason).toEqual("never-answered");
        expect(row.obligationId).not.toBeNull();
      }

      // And the reason is on the obligation, so a board three years later can
      // see not just that the guards went in but why they had to.
      const obligation = await withBuildingTx(president.building.id, (tx) =>
        tx.obligation.findUnique({
          where: { id: silent[0]!.obligationId! },
          select: { detail: true },
        }),
      );
      expect(obligation?.detail).toMatch(/Never answered/);
      expect(obligation?.detail).toMatch(/cannot conclude otherwise from silence/i);
    });

    it("refuses while a household still has time to answer", async () => {
      // Silence on the fifth of February is a neighbour who has not got round
      // to it, not a household that ignored the building.
      const campaignId = await open(openWindow());
      await deliverAllByHand(campaignId);

      const result = await closeCampaign(president, campaignId);
      expect(!result.ok && result.code).toEqual("conflict");
      expect(!result.ok && result.message).toMatch(/before anyone was late/);
    });

    it("refuses while an apartment has not been written to at all", async () => {
      // An apartment nobody wrote to has neither answered nor ignored you.
      // Closing around it would record a conclusion nobody is entitled to draw.
      const campaignId = await open();
      const campaign = await getCampaign(president, campaignId);

      // Every apartment but one.
      for (const delivery of campaign!.deliveries.slice(1)) {
        await recordDelivery(president, delivery.id, {
          method: "HAND",
          sentOn: today(),
          documentId: null,
        });
      }

      const result = await closeCampaign(president, campaignId);
      expect(!result.ok && result.code).toEqual("conflict");
      expect(!result.ok && result.message).toContain(
        campaign!.deliveries[0]!.unitLabel,
      );
    });

    it("does not stack duplicates when the work is already booked", async () => {
      const campaignId = await open();
      await deliverAllByHand(campaignId);

      const before = await getCampaign(president, campaignId);
      await recordResponse(president, before!.deliveries[0]!.id, {
        answer: "YES",
        note: null,
        respondedOn: today(),
        documentId: null,
      });

      const closed = await closeCampaign(president, campaignId);
      // Five silences, and the yes already had its follow-up.
      expect(closed.ok && closed.data.followUps).toEqual(5);

      const after = await getCampaign(president, campaignId);
      const obligations = after!.deliveries
        .map((row) => row.obligationId)
        .filter(Boolean);
      expect(new Set(obligations).size).toEqual(6);
    });

    it("closes cleanly when everybody said no", async () => {
      const campaignId = await open();
      await deliverAllByHand(campaignId);

      const campaign = await getCampaign(president, campaignId);
      for (const delivery of campaign!.deliveries) {
        await recordResponse(president, delivery.id, {
          answer: "NO",
          note: null,
          respondedOn: today(),
          documentId: null,
        });
      }

      const closed = await closeCampaign(president, campaignId);
      expect(closed.ok && closed.data.followUps).toEqual(0);
    });

    it("cannot be closed twice", async () => {
      const campaignId = await open();
      await deliverAllByHand(campaignId);
      await closeCampaign(president, campaignId);

      const again = await closeCampaign(president, campaignId);
      expect(!again.ok && again.code).toEqual("conflict");
    });

    it("will not take an answer after it is closed", async () => {
      const campaignId = await open();
      await deliverAllByHand(campaignId);
      await closeCampaign(president, campaignId);

      const campaign = await getCampaign(president, campaignId);
      const result = await recordResponse(president, campaign!.deliveries[0]!.id, {
        answer: "NO",
        note: null,
        respondedOn: today(),
        documentId: null,
      });
      expect(!result.ok && result.code).toEqual("conflict");
    });

    it("is not something a shareholder can do", async () => {
      const campaignId = await open();
      await deliverAllByHand(campaignId);

      await expect(closeCampaign(shareholder, campaignId)).rejects.toBeInstanceOf(
        CapabilityError,
      );
    });
  });

  describe("counting before closing", () => {
    it("does not count silence as work until the deadline passes", async () => {
      const stillOpen = await open(openWindow());
      await deliverAllByHand(stillOpen);
      const open1 = await getCampaign(president, stillOpen);
      expect(open1!.standing.owedWork).toEqual(0);
      expect(open1!.standing.silent).toEqual(6);

      const late = await open();
      await deliverAllByHand(late);
      const open2 = await getCampaign(president, late);
      expect(open2!.standing.owedWork).toEqual(6);
    });

    it("shows the same counts on the list as on the campaign", async () => {
      const campaignId = await open();
      await deliverAllByHand(campaignId);

      const detail = await getCampaign(president, campaignId);
      const listed = (await listCampaigns(president)).find(
        (row) => row.id === campaignId,
      );

      expect(listed?.standing).toEqual(detail?.standing);
    });
  });

  describe("what a neighbour may see", () => {
    it("shows the counts but not which apartment has a child in it", async () => {
      // How many apartments the building owes work to is a compliance fact.
      // Which apartment has a child under six in it is not.
      const campaignId = await open();
      await deliverAllByHand(campaignId);

      const campaign = await getCampaign(president, campaignId);
      const garden = campaign!.deliveries.find((row) => row.unitLabel === "GARDEN")!;
      await recordResponse(president, garden.id, {
        answer: "YES",
        note: "Two children, 4 and 7.",
        respondedOn: today(),
        documentId: null,
      });

      const asNeighbour = await getCampaign(neighbour, campaignId);
      const row = asNeighbour!.deliveries.find((d) => d.id === garden.id)!;

      expect(row.visible).toBe(false);
      expect(row.response).toBeNull();
      expect(row.recipientEmail).toBeNull();
      expect(row.recipientName).toEqual("GARDEN");
      // The standing is still theirs to see.
      expect(asNeighbour!.standing.owedWork).toBeGreaterThan(0);
      // And the fact that somebody answered is not itself a secret.
      expect(row.respondedAt).not.toBeNull();

      // Their own apartment is theirs to read.
      const own = asNeighbour!.deliveries.find((d) => d.unitLabel === "2R")!;
      expect(own.visible).toBe(true);
    });

    it("does not hand a neighbour the notification log", async () => {
      // It carries the addresses the notices went to, and the notice text.
      const campaignId = await open();
      await sendCampaign(president, campaignId);

      expect(await noticeLog(neighbour, campaignId)).toEqual([]);
      expect((await noticeLog(president, campaignId)).length).toBeGreaterThan(0);
    });
  });

  describe("the seeded January notices", () => {
    it("leave the building carrying work nobody has written down", async () => {
      // The state the module is about, at rest: the notice went out, most of
      // the building answered, and until somebody closes it the apartment that
      // never replied is work the building owes and has not recorded.
      const campaigns = await listCampaigns(president);
      const guard = campaigns.find(
        (row) => row.noticeType === "WINDOW_GUARD" && row.closedAt === null,
      );

      expect(guard).toBeDefined();
      expect(guard!.standing.everyoneHeard).toBe(true);
      expect(guard!.standing.silent).toBeGreaterThan(0);
      expect(guard!.standing.owedWork).toBeGreaterThan(guard!.standing.silent - 1);
    });
  });
});
