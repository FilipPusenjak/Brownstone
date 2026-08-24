import { beforeAll, describe, expect, it } from "vitest";
import { CapabilityError } from "~/lib/auth/capabilities";
import type { BuildingContext } from "~/lib/db/context";
import { listObligations } from "~/lib/db/scoped/compliance";
import { unitLedger } from "~/lib/db/scoped/ledger";
import {
  getSublet,
  listSublets,
  liveCharges,
  subletCap,
} from "~/lib/db/scoped/sublets";
import {
  actOnSublet,
  applyToSublet,
  commentOnSublet,
  endSublet,
  postSubletFee,
  renewSublet,
} from "~/lib/db/scoped/sublet-writes";
import { listUnitsWithShares } from "~/lib/db/scoped/units";
import { expect as unwrap } from "~/lib/result";
import { makeDate, type PlainDate } from "~/lib/time";
import { ADELAIDE, LISPENARD, PEOPLE, contextFor } from "../helpers/context";

/**
 * The sublet register, and the cap.
 *
 * The Adelaide is six apartments with a twenty per cent cap, so exactly one may
 * be sublet at a time — which makes it the ideal building to test the boundary
 * in, because the second application is always the one that has to be refused.
 *
 * The rule under test is a building-wide invariant rather than an
 * authorisation: it is not "who decided" but "would this put the corporation
 * over its own lease". It is checked at approval rather than application,
 * because the count moves underneath a pending application, and it is checked
 * as of the term's start date rather than today.
 */

/** Terms far enough out that the seeded sublet never collides with them. */
function term(year: number): { start: PlainDate; end: PlainDate } {
  return { start: makeDate(year, 4, 1), end: makeDate(year + 1, 3, 31) };
}

describe("the sublet register", () => {
  let president: BuildingContext;
  let treasurer: BuildingContext;
  let hal: BuildingContext; // garden apartment
  let marta: BuildingContext; // 2R
  let otherBuilding: BuildingContext;

  let garden: string;
  let twoR: string;
  let fourF: string;

  beforeAll(async () => {
    president = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    treasurer = await contextFor(PEOPLE.desmondTreasurer, ADELAIDE);
    hal = await contextFor(PEOPLE.halShareholder, ADELAIDE);
    marta = await contextFor(PEOPLE.martaBoth, ADELAIDE);
    otherBuilding = await contextFor(PEOPLE.ivanPresident, LISPENARD);

    const units = await listUnitsWithShares(president);
    garden = units.find((u) => u.label === "GARDEN")!.id;
    twoR = units.find((u) => u.label === "2R")!.id;
    fourF = units.find((u) => u.label === "4F")!.id;
  });

  /** An application for `unitId`, filed by whoever holds it. */
  async function apply(
    ctx: BuildingContext,
    unitId: string,
    years: number,
    name = "Delphine Okaro",
  ): Promise<string> {
    const t = term(years);
    return unwrap(
      await applyToSublet(ctx, {
        unitId,
        subtenantName: name,
        termStart: t.start,
        termEnd: t.end,
        feeCents: 120_000,
      }),
    ).subletId;
  }

  describe("the building's cap", () => {
    it("is one apartment of six at twenty per cent", async () => {
      const cap = await subletCap(president, makeDate(2035, 6, 1));
      expect(cap.totalUnits).toEqual(6);
      expect(cap.capPercent).toEqual(20);
      // 1.2 apartments cannot be sublet, so one can.
      expect(cap.allowed).toEqual(1);
    });

    it("is visible to a plain shareholder, even though the names are not", async () => {
      // How much of the building is sublet governs whether they may apply and
      // what a buyer's lender will ask, so the count is published.
      const cap = await subletCap(hal, makeDate(2035, 6, 1));
      expect(cap.allowed).toEqual(1);
      expect(cap.totalUnits).toEqual(6);
    });
  });

  describe("applying", () => {
    it("lets a shareholder apply for their own apartment", async () => {
      const subletId = await apply(hal, garden, 2040);

      const sublet = await getSublet(hal, subletId);
      expect(sublet?.approval?.status).toEqual("SUBMITTED");
      expect(sublet?.unit.label).toEqual("GARDEN");
      expect(sublet?.subtenantName).toEqual("Delphine Okaro");
    });

    it("refuses a shareholder applying for a neighbour's apartment", async () => {
      const t = term(2041);
      const result = await applyToSublet(hal, {
        unitId: twoR,
        subtenantName: "Someone Else",
        termStart: t.start,
        termEnd: t.end,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("forbidden");
    });

    it("refuses a term that ends before it begins", async () => {
      const result = await applyToSublet(hal, {
        unitId: garden,
        subtenantName: "Delphine Okaro",
        termStart: makeDate(2042, 6, 1),
        termEnd: makeDate(2042, 5, 1),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("invalid");
    });

    it("refuses a term long enough to be an assignment", async () => {
      const result = await applyToSublet(hal, {
        unitId: garden,
        subtenantName: "Delphine Okaro",
        termStart: makeDate(2043, 1, 1),
        termEnd: makeDate(2048, 1, 1),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/longer than a sublet/);
    });

    it("refuses one apartment holding two overlapping sublets", async () => {
      await apply(hal, garden, 2044);

      const result = await applyToSublet(hal, {
        unitId: garden,
        subtenantName: "A second subtenant",
        termStart: makeDate(2044, 9, 1),
        termEnd: makeDate(2045, 8, 31),
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/already has a sublet covering those dates/);
    });

    it("does not check the cap on the way in", async () => {
      // Being full today says nothing about a term starting in two years, by
      // which time somebody's sublet will have run out.
      const first = await apply(hal, garden, 2046);
      unwrap(await actOnSublet(president, first, { action: "approve" }));

      const second = await applyToSublet(marta, {
        unitId: twoR,
        subtenantName: "Tomas Reyes",
        termStart: makeDate(2046, 6, 1),
        termEnd: makeDate(2047, 5, 31),
      });

      // Accepted for consideration. Whether it can be *approved* is a separate
      // question, answered below.
      expect(second.ok).toBe(true);
    });
  });

  describe("approving, against the cap", () => {
    it("approves the first, and puts the expiry on the calendar", async () => {
      const subletId = await apply(hal, garden, 2050);

      unwrap(
        await actOnSublet(president, subletId, {
          action: "approve",
          note: "Standard one-year term.",
        }),
      );

      const sublet = await getSublet(hal, subletId);
      expect(sublet?.approval?.status).toEqual("APPROVED");
      expect(sublet?.obligationId).not.toBeNull();

      // A date filed and forgotten is worth nothing; being told sixty days out
      // is the product.
      const obligations = await listObligations(president);
      const expiry = obligations.find((o) => o.id === sublet?.obligationId);
      expect(expiry?.kind).toEqual("SUBLET_EXPIRY");
      expect(expiry?.title).toMatch(/GARDEN sublet ends/);
    });

    it("refuses the second, because it would put the building over its cap", async () => {
      const first = await apply(hal, garden, 2052);
      unwrap(await actOnSublet(president, first, { action: "approve" }));

      const second = await apply(marta, twoR, 2052, "Tomas Reyes");
      const result = await actOnSublet(president, second, { action: "approve" });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("conflict");
      expect(result.message).toMatch(
        /allows 1 of 6 apartments to be sublet at once, and 1 already is/,
      );

      // And it stayed pending rather than half-approved.
      expect((await getSublet(marta, second))?.approval?.status).toEqual("SUBMITTED");
    });

    it("counts the cap as of the term's start, not today", async () => {
      // One apartment sublet through 2055, another applying for 2057. The
      // building will not be over its cap when the second subtenant moves in.
      const first = await apply(hal, garden, 2054);
      unwrap(await actOnSublet(president, first, { action: "approve" }));

      const later = await apply(marta, twoR, 2057, "Tomas Reyes");
      const result = await actOnSublet(president, later, { action: "approve" });

      expect(result.ok).toBe(true);
    });

    it("frees the slot when a sublet ends early", async () => {
      const first = await apply(hal, garden, 2060);
      unwrap(await actOnSublet(president, first, { action: "approve" }));

      const second = await apply(marta, twoR, 2060, "Tomas Reyes");
      expect((await actOnSublet(president, second, { action: "approve" })).ok).toBe(
        false,
      );

      // The subtenant leaves in the autumn.
      unwrap(
        await endSublet(president, first, {
          endedOn: makeDate(2060, 9, 1),
          reason: "Subtenant took a job out of state.",
        }),
      );

      // The second application was for a term starting 1 April 2060, which is
      // still inside the first one — so it is still refused.
      expect((await actOnSublet(president, second, { action: "approve" })).ok).toBe(
        false,
      );

      // But one starting after the early end is fine. Filed by the president on
      // 4F's behalf, which officers who see the whole register may do.
      const third = unwrap(
        await applyToSublet(president, {
          unitId: fourF,
          subtenantName: "Someone New",
          termStart: makeDate(2060, 10, 1),
          termEnd: makeDate(2061, 9, 30),
        }),
      ).subletId;
      expect((await actOnSublet(president, third, { action: "approve" })).ok).toBe(
        true,
      );
    });

    it("refuses a plain shareholder approving their own application", async () => {
      const subletId = await apply(hal, garden, 2062);

      const result = await actOnSublet(hal, subletId, { action: "approve" });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("conflict");
    });

    it("lets the applicant withdraw, and nobody else", async () => {
      const subletId = await apply(hal, garden, 2064);

      const byNeighbour = await actOnSublet(marta, subletId, { action: "withdraw" });
      expect(byNeighbour.ok).toBe(false);

      unwrap(await actOnSublet(hal, subletId, { action: "withdraw" }));
      expect((await getSublet(hal, subletId))?.approval?.status).toEqual("WITHDRAWN");
    });

    it("does not count a withdrawn application against the cap", async () => {
      const withdrawn = await apply(hal, garden, 2066);
      unwrap(await actOnSublet(hal, withdrawn, { action: "withdraw" }));

      const real = await apply(marta, twoR, 2066, "Tomas Reyes");
      expect((await actOnSublet(president, real, { action: "approve" })).ok).toBe(true);
    });

    it("insists on saying what the conditions are", async () => {
      const subletId = await apply(hal, garden, 2068);

      const result = await actOnSublet(president, subletId, {
        action: "approveWithConditions",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toEqual("invalid");
    });

    it("will not re-decide a decided application", async () => {
      const subletId = await apply(hal, garden, 2070);
      unwrap(await actOnSublet(president, subletId, { action: "deny", note: "No." }));

      const second = await actOnSublet(president, subletId, { action: "approve" });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.code).toEqual("conflict");
    });
  });

  describe("ending early", () => {
    it("refuses a date outside the term", async () => {
      const subletId = await apply(hal, garden, 2072);
      unwrap(await actOnSublet(president, subletId, { action: "approve" }));

      const early = await endSublet(president, subletId, {
        endedOn: makeDate(2072, 1, 1),
      });
      expect(early.ok).toBe(false);

      const late = await endSublet(president, subletId, {
        endedOn: makeDate(2075, 1, 1),
      });
      expect(late.ok).toBe(false);
      if (late.ok) return;
      expect(late.message).toMatch(/after the term was due to end/);
    });

    it("closes the expiry reminder, because that date is no longer coming", async () => {
      const subletId = await apply(hal, garden, 2074);
      unwrap(await actOnSublet(president, subletId, { action: "approve" }));
      const obligationId = (await getSublet(president, subletId))!.obligationId!;

      unwrap(await endSublet(president, subletId, { endedOn: makeDate(2074, 9, 1) }));

      const obligations = await listObligations(president);
      expect(obligations.find((o) => o.id === obligationId)?.state).toEqual(
        "COMPLETED",
      );
    });

    it("refuses a plain shareholder", async () => {
      const subletId = await apply(hal, garden, 2076);
      unwrap(await actOnSublet(president, subletId, { action: "approve" }));

      await expect(
        endSublet(hal, subletId, { endedOn: makeDate(2076, 9, 1) }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });
  });

  describe("the fee", () => {
    const DUE = makeDate(2080, 5, 1);

    it("refuses before the board has approved it", async () => {
      const subletId = await apply(hal, garden, 2080);

      const result = await postSubletFee(treasurer, subletId, { dueOn: DUE });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/hasn't approved this sublet/);
    });

    it("posts the agreed fee to the apartment's ledger once approved", async () => {
      const subletId = await apply(hal, garden, 2082);
      unwrap(await actOnSublet(president, subletId, { action: "approve" }));

      const charged = unwrap(
        await postSubletFee(treasurer, subletId, { dueOn: makeDate(2082, 5, 1) }),
      );

      const sublet = await getSublet(treasurer, subletId);
      expect(liveCharges(sublet!.charges)).toHaveLength(1);
      expect(liveCharges(sublet!.charges)[0]?.amountCents).toEqual(120_000);

      const ledger = await unitLedger(treasurer, garden);
      const posted = ledger.charges.find((c) => c.id === charged.chargeId);
      expect(posted?.kind).toEqual("SUBLET_FEE");
      expect(posted?.amountCents).toEqual(120_000);
    });

    it("refuses to charge it twice", async () => {
      const subletId = await apply(hal, garden, 2084);
      unwrap(await actOnSublet(president, subletId, { action: "approve" }));
      unwrap(await postSubletFee(treasurer, subletId, { dueOn: makeDate(2084, 5, 1) }));

      const second = await postSubletFee(treasurer, subletId, {
        dueOn: makeDate(2084, 5, 1),
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.message).toMatch(/already been charged/);
    });

    it("refuses an officer who is not the treasurer", async () => {
      const subletId = await apply(hal, garden, 2086);
      unwrap(await actOnSublet(president, subletId, { action: "approve" }));

      await expect(
        postSubletFee(president, subletId, { dueOn: makeDate(2086, 5, 1) }),
      ).rejects.toBeInstanceOf(CapabilityError);
    });
  });

  describe("renewal", () => {
    it("files a fresh application starting the day after the last one ends", async () => {
      const first = await apply(hal, garden, 2090);
      unwrap(await actOnSublet(president, first, { action: "approve" }));

      const renewed = unwrap(
        await renewSublet(hal, first, { termEnd: makeDate(2092, 3, 31) }),
      );

      const sublet = await getSublet(hal, renewed.subletId);
      // The old term ran to 31 March 2091, so the renewal picks up on 1 April.
      expect(sublet?.termStart.toISOString().slice(0, 10)).toEqual("2091-04-01");
      expect(sublet?.renewedFromId).toEqual(first);
      // A renewal is a fresh application, not an extended term — the board has
      // to be able to say no the second time.
      expect(sublet?.approval?.status).toEqual("SUBMITTED");
    });

    it("re-checks the cap, so a renewal can be refused", async () => {
      const first = await apply(hal, garden, 2094);
      unwrap(await actOnSublet(president, first, { action: "approve" }));
      const renewed = unwrap(
        await renewSublet(hal, first, { termEnd: makeDate(2096, 3, 31) }),
      );

      // A neighbour takes the one available slot for the renewal's window.
      const neighbour = unwrap(
        await applyToSublet(marta, {
          unitId: twoR,
          subtenantName: "Tomas Reyes",
          termStart: makeDate(2095, 4, 1),
          termEnd: makeDate(2096, 3, 31),
        }),
      ).subletId;
      unwrap(await actOnSublet(president, neighbour, { action: "approve" }));

      const result = await actOnSublet(president, renewed.subletId, {
        action: "approve",
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.message).toMatch(/over its cap/);
    });
  });

  describe("who can see it", () => {
    it("keeps one apartment's application from the neighbours", async () => {
      const subletId = await apply(hal, garden, 2100);

      expect(await getSublet(hal, subletId)).not.toBeNull();
      expect(await getSublet(president, subletId)).not.toBeNull();
      expect(await getSublet(marta, subletId)).toBeNull();

      expect((await listSublets(marta)).map((s) => s.id)).not.toContain(subletId);
    });

    it("keeps the board's private thread away from the applicant", async () => {
      const subletId = await apply(hal, garden, 2102);

      unwrap(
        await commentOnSublet(hal, subletId, {
          body: "Happy to answer anything about the subtenant.",
        }),
      );
      unwrap(
        await commentOnSublet(president, subletId, {
          body: "This is his third subtenant in four years.",
          boardOnly: true,
        }),
      );

      expect((await getSublet(president, subletId))?.comments).toHaveLength(2);
      expect((await getSublet(hal, subletId))?.comments).toHaveLength(1);
    });

    it("keeps one building's register out of another's", async () => {
      const subletId = await apply(hal, garden, 2104);
      expect(await getSublet(otherBuilding, subletId)).toBeNull();
    });

    it("counts only this building's sublets against this building's cap", async () => {
      // Lispenard House is ten apartments at twenty-five per cent.
      const theirs = await subletCap(otherBuilding, makeDate(2035, 6, 1));
      expect(theirs.totalUnits).toEqual(10);
      expect(theirs.allowed).toEqual(2);
    });
  });
});
