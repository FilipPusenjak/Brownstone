import { beforeAll, describe, expect, it } from "vitest";
import type { BuildingContext } from "~/lib/db/context";
import {
  NoSuchBuildingError,
  memberBuildings,
  resolveBuildingContext,
} from "~/lib/db/context";
import * as alterations from "~/lib/db/scoped/alterations";
import * as audit from "~/lib/db/scoped/audit";
import * as work from "~/lib/db/scoped/work";
import * as compliance from "~/lib/db/scoped/compliance";
import * as documents from "~/lib/db/scoped/documents";
import * as ledger from "~/lib/db/scoped/ledger";
import * as meetings from "~/lib/db/scoped/meetings";
import * as modules from "~/lib/db/scoped/modules";
import * as tickets from "~/lib/db/scoped/tickets";
import * as notifications from "~/lib/db/scoped/notifications";
import * as units from "~/lib/db/scoped/units";
import {
  ADELAIDE,
  LISPENARD,
  PEOPLE,
  buildingIds,
  contextFor,
  userIdFor,
} from "../helpers/context";

/**
 * Tenant isolation.
 *
 * The design goal is that this test proves separation rather than merely
 * passing. Three things make it more than decorative:
 *
 *   1. It calls *every* scoped reader through the real query modules, with a
 *      real context built by the real resolver — not a stub.
 *   2. It asserts on the seeded data being similar. Both buildings have a 2F, a
 *      3R and a 4F, and maintenance charges in the same range, so a leak would
 *      return plausible rows rather than obviously foreign ones.
 *   3. `coverage.test.ts` fails the build if a tenant table exists that this
 *      file's registry does not name, so the suite cannot quietly fall behind
 *      the schema.
 */

type Reader = (ctx: BuildingContext) => Promise<unknown>;

/**
 * Every scoped read in the application, and the tenant table each one covers.
 *
 * Adding a scoped module means adding it here. `coverage.test.ts` checks the
 * table names against the database, so an omission is a failing build rather
 * than a silent gap.
 */
const READERS: Array<{ name: string; tables: string[]; read: Reader }> = [
  { name: "units.listUnits", tables: ["Unit"], read: units.listUnits },
  { name: "units.listUnitsWithShares", tables: [], read: units.listUnitsWithShares },
  {
    name: "units.listShareAllocations",
    tables: ["ShareAllocation"],
    read: units.listShareAllocations,
  },
  {
    name: "units.listUnitHoldings",
    tables: ["UnitHolding"],
    read: units.listUnitHoldings,
  },
  { name: "units.listMembers", tables: ["Membership"], read: units.listMembers },
  {
    name: "units.listMembershipUnits",
    tables: ["MembershipUnit"],
    read: units.listMembershipUnits,
  },
  {
    name: "units.listInvitationsForTenancyCheck",
    tables: ["Invitation"],
    read: units.listInvitationsForTenancyCheck,
  },

  {
    name: "compliance.listObligations",
    tables: ["Obligation"],
    read: compliance.listObligations,
  },
  {
    name: "compliance.listAssessmentsForTenancyCheck",
    tables: ["BuildingRuleAssessment"],
    read: compliance.listAssessmentsForTenancyCheck,
  },
  {
    name: "compliance.listReminders",
    tables: ["ObligationReminder"],
    read: compliance.listReminders,
  },

  {
    name: "documents.listDocumentsForTenancyCheck",
    tables: ["Document"],
    read: documents.listDocumentsForTenancyCheck,
  },
  {
    name: "documents.listDocumentLinks",
    tables: ["DocumentLink"],
    read: documents.listDocumentLinks,
  },
  {
    name: "documents.listCertificatesForTenancyCheck",
    tables: ["CertificateOfInsurance"],
    read: documents.listCertificatesForTenancyCheck,
  },

  {
    name: "alterations.listAlterationsForTenancyCheck",
    tables: ["AlterationRequest"],
    read: alterations.listAlterationsForTenancyCheck,
  },
  {
    name: "alterations.listApprovalRequestsForTenancyCheck",
    tables: ["ApprovalRequest"],
    read: alterations.listApprovalRequestsForTenancyCheck,
  },
  {
    name: "alterations.listApprovalComments",
    tables: ["ApprovalComment"],
    read: alterations.listApprovalComments,
  },

  {
    name: "ledger.listChargesForTenancyCheck",
    tables: ["Charge"],
    read: ledger.listChargesForTenancyCheck,
  },
  {
    name: "ledger.listPaymentsForTenancyCheck",
    tables: ["Payment"],
    read: ledger.listPaymentsForTenancyCheck,
  },
  {
    name: "ledger.listPaymentPlans",
    tables: ["PaymentPlan"],
    read: ledger.listPaymentPlans,
  },

  {
    name: "work.listWorkForTenancyCheck",
    tables: ["BuildingWork"],
    read: work.listWorkForTenancyCheck,
  },

  {
    name: "audit.listAuditForTenancyCheck",
    tables: ["AuditLog"],
    read: audit.listAuditForTenancyCheck,
  },
  {
    name: "notifications.listNotifications",
    tables: ["Notification"],
    read: notifications.listNotifications,
  },

  {
    name: "meetings.listMeetingsForTenancyCheck",
    tables: ["Meeting"],
    read: meetings.listMeetingsForTenancyCheck,
  },
  {
    name: "meetings.listAttendanceForTenancyCheck",
    tables: ["MeetingAttendance"],
    read: meetings.listAttendanceForTenancyCheck,
  },
  {
    name: "meetings.listProxiesForTenancyCheck",
    tables: ["Proxy"],
    read: meetings.listProxiesForTenancyCheck,
  },
  {
    name: "meetings.listResolutionsForTenancyCheck",
    tables: ["Resolution"],
    read: meetings.listResolutionsForTenancyCheck,
  },
  {
    name: "meetings.listResolutionVotesForTenancyCheck",
    tables: ["ResolutionVote"],
    read: meetings.listResolutionVotesForTenancyCheck,
  },
  {
    name: "modules.listSublets",
    tables: ["SubletRegistration"],
    read: modules.listSublets,
  },
  { name: "modules.listResources", tables: ["Resource"], read: modules.listResources },
  {
    name: "modules.listResourcePrerequisites",
    tables: ["ResourcePrerequisite"],
    read: modules.listResourcePrerequisites,
  },
  { name: "modules.listBookings", tables: ["Booking"], read: modules.listBookings },
  {
    name: "modules.listBookingChecks",
    tables: ["BookingPrerequisiteCheck"],
    read: modules.listBookingChecks,
  },
  {
    name: "tickets.listTicketsForTenancyCheck",
    tables: ["Ticket"],
    read: tickets.listTicketsForTenancyCheck,
  },
  {
    name: "modules.listDutyRotations",
    tables: ["DutyRotation"],
    read: modules.listDutyRotations,
  },
  {
    name: "modules.listDutyAssignments",
    tables: ["DutyAssignment"],
    read: modules.listDutyAssignments,
  },
  { name: "modules.listDsnyFines", tables: ["DsnyFine"], read: modules.listDsnyFines },
  {
    name: "modules.listNoticeCampaigns",
    tables: ["NoticeCampaign"],
    read: modules.listNoticeCampaigns,
  },
  {
    name: "modules.listNoticeDeliveries",
    tables: ["NoticeDelivery"],
    read: modules.listNoticeDeliveries,
  },
];

export const COVERED_TABLES = new Set(READERS.flatMap((r) => r.tables));

/** Pulls every `buildingId` out of an arbitrary query result. */
function buildingIdsIn(value: unknown, found: string[] = []): string[] {
  if (Array.isArray(value)) {
    for (const item of value) buildingIdsIn(item, found);
    return found;
  }
  if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (key === "buildingId" && typeof nested === "string") found.push(nested);
      else buildingIdsIn(nested, found);
    }
  }
  return found;
}

describe("tenant isolation", () => {
  let adelaideId: string;
  let lispenardId: string;

  beforeAll(async () => {
    ({ adelaide: adelaideId, lispenard: lispenardId } = await buildingIds());
  });

  it("seeds two buildings that look alike, so a leak would look like real data", async () => {
    const nora = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    const ivan = await contextFor(PEOPLE.ivanPresident, LISPENARD);

    const adelaideLabels = (await units.listUnits(nora)).map((u) => u.label);
    const lispenardLabels = (await units.listUnits(ivan)).map((u) => u.label);

    const shared = adelaideLabels.filter((label) => lispenardLabels.includes(label));
    expect(shared).toContain("2F");
    expect(shared).toContain("3R");
    expect(shared.length).toBeGreaterThanOrEqual(3);
    expect(adelaideId).not.toEqual(lispenardId);
  });

  describe.each([
    { who: "an officer", email: PEOPLE.noraPresident },
    { who: "a plain shareholder", email: PEOPLE.halShareholder },
    { who: "a member of both buildings", email: PEOPLE.martaBoth },
  ])("as $who in The Adelaide", ({ email }) => {
    it.each(READERS)(
      "$name returns nothing from the other building",
      async ({ read }) => {
        const ctx = await contextFor(email, ADELAIDE);
        const rows = await read(ctx);

        const ids = buildingIdsIn(rows);
        expect(ids).not.toContain(lispenardId);
        for (const id of ids) expect(id).toEqual(adelaideId);
      },
    );
  });

  describe("as a member of Lispenard House", () => {
    it.each(READERS)("$name returns nothing from The Adelaide", async ({ read }) => {
      const ctx = await contextFor(PEOPLE.ivanPresident, LISPENARD);
      const ids = buildingIdsIn(await read(ctx));

      expect(ids).not.toContain(adelaideId);
      for (const id of ids) expect(id).toEqual(lispenardId);
    });
  });

  describe("context resolution", () => {
    it("refuses a building the user is not a member of", async () => {
      const ivanId = await userIdFor(PEOPLE.ivanPresident);
      await expect(resolveBuildingContext(ivanId, ADELAIDE)).rejects.toThrow(
        NoSuchBuildingError,
      );
    });

    it("refuses a building that does not exist", async () => {
      const noraId = await userIdFor(PEOPLE.noraPresident);
      await expect(resolveBuildingContext(noraId, "no-such-building")).rejects.toThrow(
        NoSuchBuildingError,
      );
    });

    it("gives a dual member two separate contexts, never a merged one", async () => {
      const inAdelaide = await contextFor(PEOPLE.martaBoth, ADELAIDE);
      const inLispenard = await contextFor(PEOPLE.martaBoth, LISPENARD);

      expect(inAdelaide.user.id).toEqual(inLispenard.user.id);
      expect(inAdelaide.building.id).not.toEqual(inLispenard.building.id);
      expect(inAdelaide.membership.id).not.toEqual(inLispenard.membership.id);

      // She owns 2R in one building and 3R in the other. Neither context may
      // carry the other's unit, or unit scoping would leak across buildings.
      const overlap = inAdelaide.unitIds.filter((id) =>
        inLispenard.unitIds.includes(id),
      );
      expect(overlap).toEqual([]);
    });

    it("lists only the buildings a user actually belongs to", async () => {
      const marta = await memberBuildings(await userIdFor(PEOPLE.martaBoth));
      const nora = await memberBuildings(await userIdFor(PEOPLE.noraPresident));

      expect(marta.map((b) => b.slug).sort()).toEqual([ADELAIDE, LISPENARD].sort());
      expect(nora.map((b) => b.slug)).toEqual([ADELAIDE]);
    });
  });

  describe("unit scoping within a building", () => {
    it("shows a shareholder their own ledger and no one else's", async () => {
      const hal = await contextFor(PEOPLE.halShareholder, ADELAIDE);
      const charges = await ledger.listCharges(hal);

      expect(charges.length).toBeGreaterThan(0);
      for (const charge of charges) {
        expect(hal.unitIds).toContain(charge.unitId);
      }
    });

    it("shows the treasurer every unit's ledger", async () => {
      const desmond = await contextFor(PEOPLE.desmondTreasurer, ADELAIDE);
      const hal = await contextFor(PEOPLE.halShareholder, ADELAIDE);

      const all = await ledger.listCharges(desmond);
      const mine = await ledger.listCharges(hal);

      const unitsSeen = new Set(all.map((c) => c.unitId));
      expect(unitsSeen.size).toBeGreaterThan(hal.unitIds.length);
      expect(all.length).toBeGreaterThan(mine.length);
    });

    it("refuses a shareholder another unit's ledger even when asked directly", async () => {
      const hal = await contextFor(PEOPLE.halShareholder, ADELAIDE);
      const desmond = await contextFor(PEOPLE.desmondTreasurer, ADELAIDE);

      const someoneElse = desmond.unitIds[0];
      expect(someoneElse).toBeDefined();
      expect(hal.unitIds).not.toContain(someoneElse);

      const result = await ledger.unitLedger(hal, someoneElse as string);
      expect(result.charges).toEqual([]);
      expect(result.payments).toEqual([]);
    });

    it("hides board-only comments from the shareholder who filed the request", async () => {
      const nora = await contextFor(PEOPLE.noraPresident, ADELAIDE);
      const hal = await contextFor(PEOPLE.halShareholder, ADELAIDE);

      const boardView = await alterations.listApprovalComments(nora);
      const memberView = await alterations.listApprovalComments(hal);

      expect(boardView.some((c) => c.visibility === "BOARD_ONLY")).toBe(true);
      expect(memberView.every((c) => c.visibility === "SHARED")).toBe(true);
    });

    it("keeps arrears away from an officer who is not the treasurer", async () => {
      const priya = await contextFor("priya.raman@example.com", ADELAIDE);
      expect(priya.capabilities.has("arrears.viewAll")).toBe(false);

      const charges = await ledger.listCharges(priya);
      for (const charge of charges) expect(priya.unitIds).toContain(charge.unitId);
    });
  });
});
