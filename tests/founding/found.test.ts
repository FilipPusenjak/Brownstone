import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBuildingContext, NoSuchBuildingError } from "~/lib/db/context";
import { withBuildingTx, withUntenantedTx } from "~/lib/db/tx";
import { resetEnvCache } from "~/lib/env";
import type { Lookup } from "~/lib/nyc/lookup";
import { DEFAULT_SHARES, FOUNDING_ALLOCATION_NOTE } from "~/lib/primitives/founding";
import { expect as unwrap } from "~/lib/result";
import { ADELAIDE, contextFor, PEOPLE, userIdFor } from "../helpers/context";

/**
 * Founding a building.
 *
 * This is the only write in the system that starts without a
 * `BuildingContext`, which makes it the only one where "who is allowed to do
 * this" cannot be answered by a capability check. So the guarantees worth
 * pinning are different in kind from every other suite here:
 *
 *   the building that comes out is complete enough to open — units, shares,
 *   a membership, and a rule assessment for every rule on the books;
 *
 *   nothing partial survives a failure, because a building whose founder has
 *   no membership is a building nobody can ever open;
 *
 *   and founding one grants no sight of any other. The founder is a stranger
 *   to every co-op already on the deployment, and stays one.
 */

// The city is not called from a unit suite. `tests/nyc/address.test.ts` pins
// the query-building rules against conventions checked by hand; here the
// lookup is stubbed so that provenance — MANUAL, NYC_OPEN_DATA or MIXED — can
// be asserted against a known answer instead of against Socrata's mood.
const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("~/lib/nyc/lookup", () => ({ lookupBuilding: lookupMock }));

const { foundBuilding } = await import("~/lib/db/founding");

const NOTHING_FOUND: Lookup = { kind: "not-found", triedAddress: "1 NOWHERE STREET" };

function cityKnows(overrides: Partial<Record<string, unknown>> = {}): Lookup {
  return {
    kind: "found",
    matchedAddress: "150 BERGEN STREET",
    attributes: {
      unitCount: 4,
      stories: 3,
      yearBuilt: 1850,
      grossSquareFeet: 3566,
      facadeHeightFt: 39,
      isLandmarked: true,
      zip: "11217",
      communityDistrict: "BK 02",
      bbl: "3003860014",
      bin: "3005843",
      ...overrides,
    },
    payload: { pluto: { address: "150 BERGEN STREET" } },
  };
}

/** A signed-up account that belongs to nothing yet — the founder's situation. */
async function newcomer(): Promise<{ id: string; email: string }> {
  const email = `founder-${randomUUID()}@example.com`;
  const user = await withUntenantedTx((tx) =>
    tx.user.create({ data: { email }, select: { id: true, email: true } }),
  );
  return user;
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    name: `Bergen ${randomUUID().slice(0, 8)}`,
    legalName: "Bergen Street Owners Corp.",
    addressLine1: "150 Bergen Street",
    addressLine2: null,
    borough: "BROOKLYN" as const,
    zip: "11217",
    timezone: "America/New_York",
    floorNaming: "BROWNSTONE" as const,
    stories: 3,
    yearBuilt: 1850,
    grossSquareFeet: 3566,
    facadeHeightFt: 39,
    hasElevator: false,
    gasService: "HEATING_AND_COOKING" as const,
    oilTankPresent: false,
    sprinklerStatus: "NONE" as const,
    isLandmarked: true,
    hasParapet: true,
    apartments: [
      { label: "GARDEN", floorIndex: 0, line: null, shares: DEFAULT_SHARES },
      { label: "1F", floorIndex: 1, line: "F", shares: DEFAULT_SHARES },
      { label: "2F", floorIndex: 2, line: "F", shares: DEFAULT_SHARES },
      { label: "3F", floorIndex: 3, line: "F", shares: DEFAULT_SHARES },
    ],
    ownLabel: "1F",
    title: "Board President",
    ...overrides,
  };
}

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockResolvedValue(NOTHING_FOUND);
  delete process.env["ALLOW_NEW_BUILDINGS"];
  resetEnvCache();
});

afterEach(() => {
  delete process.env["ALLOW_NEW_BUILDINGS"];
  resetEnvCache();
});

describe("what founding produces", () => {
  it("makes a building its founder can open", async () => {
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input()));

    // The real resolver, not a hand-made context: if founding produced a
    // membership the resolver cannot see, the building is unreachable and the
    // person who made it is locked out of it permanently.
    const ctx = await resolveBuildingContext(founder.id, founded.slug);

    expect(ctx.building.id).toEqual(founded.buildingId);
    expect(ctx.membership.roles).toContain("PRESIDENT");
    expect(ctx.membership.roles).toContain("SHAREHOLDER");
    expect(ctx.membership.title).toEqual("Board President");
    expect(ctx.capabilities.has("member.invite")).toBe(true);
    expect(ctx.capabilities.has("building.manage")).toBe(true);
  });

  it("links the founder to the apartment they said was theirs", async () => {
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input({ ownLabel: "2F" })));
    const ctx = await resolveBuildingContext(founder.id, founded.slug);

    const held = await withBuildingTx(founded.buildingId, (tx) =>
      tx.unit.findMany({
        where: { id: { in: [...ctx.unitIds] } },
        select: { label: true },
      }),
    );
    expect(held.map((unit) => unit.label)).toEqual(["2F"]);
  });

  it("lets a managing agent found one without holding an apartment", async () => {
    // A president who owns nothing is unusual in a co-op and ordinary for the
    // person a small board hires. They get the office and not the shares.
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input({ ownLabel: null })));
    const ctx = await resolveBuildingContext(founder.id, founded.slug);

    expect(ctx.unitIds).toEqual([]);
    expect(ctx.membership.roles).toEqual(["PRESIDENT"]);

    // They are not a shareholder, so no apartment is theirs — and it is the
    // empty unit list, not the capability set, that does that work. Every
    // officer carries `arrears.viewOwnUnit`; what it resolves to is whatever
    // `unitIds` holds, which here is nothing.
    const membershipUnits = await withBuildingTx(founded.buildingId, (tx) =>
      tx.membershipUnit.count(),
    );
    expect(membershipUnits).toEqual(0);
  });

  it("records the apartments with a share allocation each", async () => {
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input()));

    const [units, allocations] = await withBuildingTx(founded.buildingId, (tx) =>
      Promise.all([
        tx.unit.findMany({ select: { label: true, floorIndex: true } }),
        tx.shareAllocation.findMany({ select: { shares: true, note: true } }),
      ]),
    );

    expect(units).toHaveLength(4);
    expect(allocations).toHaveLength(4);
    // Every allocation says out loud that nobody has typed the offering plan
    // in yet — quorum and every assessment divide by these numbers.
    for (const allocation of allocations) {
      expect(allocation.note).toEqual(FOUNDING_ALLOCATION_NOTE);
    }
  });

  it("takes the unit count from the apartment list, not from a second field", async () => {
    // Two sources for one fact drift the moment somebody adds a row, and this
    // one feeds every compliance applicability predicate in the ruleset.
    const founder = await newcomer();
    const five = [
      ...input().apartments,
      { label: "3R", floorIndex: 3, line: "R", shares: DEFAULT_SHARES },
    ];
    const founded = unwrap(
      await foundBuilding(founder.id, input({ apartments: five })),
    );

    const building = await withBuildingTx(founded.buildingId, (tx) =>
      tx.building.findUniqueOrThrow({
        where: { id: founded.buildingId },
        select: { unitCount: true },
      }),
    );
    expect(building.unitCount).toEqual(5);
  });

  it("assesses every rule and confirms none of them", async () => {
    // The calendar starts empty on purpose. A compliance calendar a machine
    // filled in is a calendar no board member owns.
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input()));

    const [assessments, obligations, ruleCount] = await Promise.all([
      withBuildingTx(founded.buildingId, (tx) =>
        tx.buildingRuleAssessment.findMany({ select: { decision: true } }),
      ),
      withBuildingTx(founded.buildingId, (tx) => tx.obligation.count()),
      withUntenantedTx((tx) => tx.complianceRule.count()),
    ]);

    expect(assessments).toHaveLength(ruleCount);
    expect(founded.proposedRules).toEqual(ruleCount);
    expect(assessments.every((row) => row.decision === "PROPOSED")).toBe(true);
    expect(obligations).toEqual(0);
  });

  it("writes down who founded it and when", async () => {
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input()));

    const [entry, building] = await withBuildingTx(founded.buildingId, (tx) =>
      Promise.all([
        tx.auditLog.findFirstOrThrow({
          select: { action: true, actorUserId: true, entityType: true, summary: true },
        }),
        tx.building.findUniqueOrThrow({
          where: { id: founded.buildingId },
          select: { attributesConfirmedAt: true, attributesConfirmedById: true },
        }),
      ]),
    );

    expect(entry.action).toEqual("building.found");
    expect(entry.actorUserId).toEqual(founder.id);
    expect(entry.entityType).toEqual("BUILDING");

    // Somebody read every attribute on a screen and pressed the button. That
    // is what confirmation is, and an unconfirmed set makes the compliance
    // assessment provisional.
    expect(building.attributesConfirmedAt).not.toBeNull();
    expect(building.attributesConfirmedById).not.toBeNull();
  });
});

describe("where the attributes came from", () => {
  it("is MANUAL when the city had nothing to say", async () => {
    lookupMock.mockResolvedValue(NOTHING_FOUND);
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input()));

    expect(await sourceOf(founded.buildingId)).toEqual("MANUAL");
  });

  it("is MANUAL when the city could not be reached", async () => {
    // An outage must not be recorded as though a person had chosen to type
    // everything, but it must also not be recorded as the city's word.
    lookupMock.mockResolvedValue({ kind: "unavailable", reason: "timeout" });
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input()));

    expect(await sourceOf(founded.buildingId)).toEqual("MANUAL");
  });

  it("is NYC_OPEN_DATA when every published figure was accepted", async () => {
    lookupMock.mockResolvedValue(cityKnows());
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input()));

    expect(await sourceOf(founded.buildingId)).toEqual("NYC_OPEN_DATA");
  });

  it("is MIXED when a person overrode one of them", async () => {
    lookupMock.mockResolvedValue(cityKnows());
    const founder = await newcomer();
    // The city says three storeys; the founder knows about the top-floor
    // addition the city does not.
    const founded = unwrap(await foundBuilding(founder.id, input({ stories: 4 })));

    expect(await sourceOf(founded.buildingId)).toEqual("MIXED");
  });

  it("does not count a figure the city never published as an override", async () => {
    // A null from PLUTO is the absence of an opinion. A founder typing a year
    // the city never had has overridden nothing.
    lookupMock.mockResolvedValue(cityKnows({ yearBuilt: null }));
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input({ yearBuilt: 1912 })));

    expect(await sourceOf(founded.buildingId)).toEqual("NYC_OPEN_DATA");
  });

  it("keeps the city's own record of what it said", async () => {
    lookupMock.mockResolvedValue(cityKnows());
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input()));

    const [lookupRow, building] = await withBuildingTx(founded.buildingId, (tx) =>
      Promise.all([
        tx.buildingDataLookup.findFirstOrThrow({
          select: { source: true, query: true },
        }),
        tx.building.findUniqueOrThrow({
          where: { id: founded.buildingId },
          select: { bbl: true, bin: true, communityDistrict: true },
        }),
      ]),
    );

    expect(lookupRow.source).toEqual("pluto");
    expect(lookupRow.query).toEqual("150 BERGEN STREET");
    // The keys come from the lookup and never from the form: a BBL somebody
    // typed is a BBL somebody guessed.
    expect(building.bbl).toEqual("3003860014");
    expect(building.bin).toEqual("3005843");
    expect(building.communityDistrict).toEqual("BK 02");
  });

  it("stores no key at all when the lookup missed", async () => {
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input()));

    const building = await withBuildingTx(founded.buildingId, (tx) =>
      tx.building.findUniqueOrThrow({
        where: { id: founded.buildingId },
        select: { bbl: true, bin: true },
      }),
    );
    expect(building.bbl).toBeNull();
    expect(building.bin).toBeNull();
  });
});

describe("what founding does not grant", () => {
  it("shows the founder nothing of anybody else's building", async () => {
    const founder = await newcomer();
    unwrap(await foundBuilding(founder.id, input()));

    await expect(resolveBuildingContext(founder.id, ADELAIDE)).rejects.toThrow(
      NoSuchBuildingError,
    );
  });

  it("is invisible to a president of another co-op", async () => {
    const founder = await newcomer();
    const founded = unwrap(await foundBuilding(founder.id, input()));

    const nora = await userIdFor(PEOPLE.noraPresident);
    await expect(resolveBuildingContext(nora, founded.slug)).rejects.toThrow(
      NoSuchBuildingError,
    );
  });

  it("leaves the buildings already here untouched", async () => {
    const before = await withBuildingTx(
      (await contextFor(PEOPLE.noraPresident, ADELAIDE)).building.id,
      (tx) => tx.unit.count(),
    );

    const founder = await newcomer();
    unwrap(await foundBuilding(founder.id, input()));

    const adelaide = await contextFor(PEOPLE.noraPresident, ADELAIDE);
    const after = await withBuildingTx(adelaide.building.id, (tx) => tx.unit.count());
    expect(after).toEqual(before);
  });
});

describe("what founding refuses", () => {
  it("refuses when the deployment has closed the door", async () => {
    // A co-op running Co-operator for itself turns this off once its building
    // exists. Anyone who can receive a sign-in link could otherwise make one.
    process.env["ALLOW_NEW_BUILDINGS"] = "0";
    resetEnvCache();

    const founder = await newcomer();
    const result = await foundBuilding(founder.id, input());

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.code).toEqual("forbidden");
  });

  it("writes nothing when it refuses", async () => {
    process.env["ALLOW_NEW_BUILDINGS"] = "0";
    resetEnvCache();

    const founder = await newcomer();
    await foundBuilding(founder.id, input());

    const memberships = await withUntenantedTx((tx) =>
      tx.membership.count({ where: { userId: founder.id } }),
    );
    expect(memberships).toEqual(0);
  });

  it("refuses a name that makes no usable web address", async () => {
    const founder = await newcomer();
    const result = await foundBuilding(founder.id, input({ name: "!!!" }));

    expect(result.ok === false && result.code).toEqual("invalid");
    expect(result.ok === false && result.fields?.["name"]).toBeTruthy();
  });

  it("refuses a name that would collide with a route", async () => {
    const founder = await newcomer();
    const result = await foundBuilding(founder.id, input({ name: "Account" }));

    expect(result.ok === false && result.code).toEqual("invalid");
  });

  it("refuses two apartments with the same name", async () => {
    const founder = await newcomer();
    const result = await foundBuilding(
      founder.id,
      input({
        apartments: [
          { label: "2F", floorIndex: 2, line: "F", shares: 100 },
          { label: "2f", floorIndex: 2, line: "F", shares: 100 },
        ],
      }),
    );

    expect(result.ok === false && result.code).toEqual("invalid");
    expect(result.ok === false && result.fields?.["apartments"]).toBeTruthy();
  });

  it("refuses an apartment the founder claims but did not list", async () => {
    const founder = await newcomer();
    const result = await foundBuilding(founder.id, input({ ownLabel: "5R" }));

    expect(result.ok === false && result.fields?.["ownLabel"]).toBeTruthy();
  });

  it("refuses a ZIP that isn't one", async () => {
    const founder = await newcomer();
    const result = await foundBuilding(founder.id, input({ zip: "1121" }));

    expect(result.ok === false && result.fields?.["zip"]).toBeTruthy();
  });

  it("leaves nothing behind when the apartments are wrong", async () => {
    // The check runs before any row is written, but the guarantee that matters
    // is the outcome, not where the check lives.
    const founder = await newcomer();
    await foundBuilding(founder.id, input({ apartments: [] }));

    const buildings = await withUntenantedTx((tx) =>
      tx.membership.count({ where: { userId: founder.id } }),
    );
    expect(buildings).toEqual(0);
  });
});

describe("two buildings wanting the same web address", () => {
  it("both get one, and neither is told about the other", async () => {
    const name = `Adelaide ${randomUUID().slice(0, 8)}`;

    const first = await newcomer();
    const second = await newcomer();

    const one = unwrap(await foundBuilding(first.id, input({ name })));
    const two = unwrap(await foundBuilding(second.id, input({ name })));

    expect(two.slug).not.toEqual(one.slug);
    // Not a counter. `adelaide-2` would tell whoever typed it exactly how many
    // other Adelaides exist on the deployment, which row-level security hides
    // everywhere else in the product.
    expect(two.slug).not.toEqual(`${one.slug}-2`);
    expect(two.slug.startsWith(one.slug)).toBe(true);

    // Both are real and openable.
    await expect(resolveBuildingContext(first.id, one.slug)).resolves.toBeTruthy();
    await expect(resolveBuildingContext(second.id, two.slug)).resolves.toBeTruthy();
  });
});

async function sourceOf(buildingId: string): Promise<string> {
  const building = await withBuildingTx(buildingId, (tx) =>
    tx.building.findUniqueOrThrow({
      where: { id: buildingId },
      select: { attributeSource: true },
    }),
  );
  return building.attributeSource;
}
