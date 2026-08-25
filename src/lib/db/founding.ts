import { randomUUID } from "node:crypto";
import type { GasService, SprinklerStatus } from "~/generated/prisma/enums";
import { assessBuilding } from "~/lib/compliance/generate";
import type { BuildingAttributes } from "~/lib/compliance/applicability";
import { env } from "~/lib/env";
import { lookupBuilding, type Lookup } from "~/lib/nyc/lookup";
import type { Borough } from "~/lib/nyc/address";
import {
  checkApartments,
  FOUNDING_ALLOCATION_NOTE,
  slugCandidates,
  slugIsUsable,
  slugify,
  type ApartmentInput,
} from "~/lib/primitives/founding";
import { fail, ok, type Result } from "~/lib/result";
import { toDbDate, today } from "~/lib/time";
import { withBuildingTx } from "./tx";

/**
 * Founding a building.
 *
 * This is the one write in the system that does not take a `BuildingContext`,
 * and it cannot: a context proves that somebody is an active member of a
 * building that exists, and here neither the building nor the membership does
 * yet. Every other path into the product is invitation-shaped — a member with
 * `member.invite` sends a link, the link creates a membership in a building
 * that is already there. That chain has to start somewhere, and this is the
 * link at the top of it.
 *
 * What authorises it is therefore not a capability but simply being signed in.
 * That is a smaller claim than it looks. Row-level security means a building
 * founded here is visible to its founder and to nobody else on the deployment,
 * so the worst a stranger can do is create rows only they can see. The control
 * that matters for a deployment serving one co-op is `ALLOW_NEW_BUILDINGS`,
 * which turns the door off once the building behind it exists.
 *
 * Everything commits together or not at all. A building whose units exist but
 * whose founder has no membership is a building nobody can open — including,
 * permanently, the person who just made it.
 */

export interface FoundBuildingInput {
  readonly name: string;
  readonly legalName: string | null;
  readonly addressLine1: string;
  readonly addressLine2: string | null;
  readonly borough: Borough;
  readonly zip: string;
  readonly timezone: string;
  readonly floorNaming: "BROWNSTONE" | "NUMERIC";

  readonly stories: number;
  readonly yearBuilt: number | null;
  readonly grossSquareFeet: number | null;
  readonly facadeHeightFt: number | null;
  readonly hasElevator: boolean;
  readonly gasService: GasService;
  readonly oilTankPresent: boolean;
  readonly sprinklerStatus: SprinklerStatus;
  readonly isLandmarked: boolean;
  readonly hasParapet: boolean;

  readonly apartments: readonly ApartmentInput[];
  /** Which apartment is the founder's, by label. Null for a managing agent. */
  readonly ownLabel: string | null;
  /** How the founder wants to be listed. Blank falls back to the account name. */
  readonly title: string | null;
}

export interface Founded {
  readonly buildingId: string;
  readonly slug: string;
  /** Rules the engine thinks apply, waiting for the board to confirm them. */
  readonly proposedRules: number;
}

/** How many slugs to try before giving up and asking for a different name. */
const SLUG_ATTEMPTS = 4;

export async function foundBuilding(
  userId: string,
  input: FoundBuildingInput,
): Promise<Result<Founded>> {
  if (!env().ALLOW_NEW_BUILDINGS) {
    return fail(
      "forbidden",
      "This deployment isn't accepting new buildings. Ask whoever runs it for an invitation to an existing one.",
    );
  }

  const invalid = validate(input);
  if (invalid) return invalid;

  const apartments = input.apartments.map((apartment) => ({
    ...apartment,
    label: apartment.label.trim().toUpperCase(),
  }));

  const slug = slugify(input.name);
  if (!slugIsUsable(slug)) {
    return fail(
      "invalid",
      "That name doesn't make a usable web address. Try adding the street, as in “The Adelaide on Bergen”.",
      { name: "Give the building a name with at least two letters or digits in it." },
    );
  }

  // Provenance is established by asking the city ourselves rather than by
  // believing the browser. A form can claim anything about where its numbers
  // came from; the point of `attributeSource` is to be evidence, and evidence
  // the client supplies about itself is not evidence.
  const lookup = await lookupBuilding({
    addressLine1: input.addressLine1,
    borough: input.borough,
    purpose: "verifying",
  });

  const attributes = attributesFrom(input, apartments.length);

  for (const candidate of slugCandidates(slug, SLUG_ATTEMPTS)) {
    const attempt = await tryFound(
      userId,
      input,
      apartments,
      attributes,
      candidate,
      lookup,
    );
    if (attempt !== "slug-taken") return attempt;
  }

  return fail(
    "conflict",
    "A building is already using that web address, and the alternatives were taken too. Try a different name.",
    { name: "Try a different name." },
  );
}

/**
 * One attempt at the whole thing.
 *
 * Slugs are unique across the deployment, and row-level security deliberately
 * prevents reading the buildings a founder does not belong to — so there is no
 * "is this taken?" query to run first. The insert is the check. A unique
 * violation aborts the transaction, which is why a retry is a fresh attempt
 * with a fresh id rather than a second insert inside the same one.
 */
async function tryFound(
  userId: string,
  input: FoundBuildingInput,
  apartments: readonly ApartmentInput[],
  attributes: BuildingAttributes,
  slug: string,
  lookup: Lookup,
): Promise<Result<Founded> | "slug-taken"> {
  const buildingId = randomUUID();
  const joinedOn = toDbDate(today());

  try {
    return await withBuildingTx(buildingId, async (tx) => {
      await tx.building.create({
        data: {
          id: buildingId,
          slug,
          name: input.name.trim(),
          legalName: input.legalName?.trim() || null,
          addressLine1: input.addressLine1.trim(),
          addressLine2: input.addressLine2?.trim() || null,
          borough: input.borough,
          zip: input.zip.trim(),
          timezone: input.timezone,
          floorNaming: input.floorNaming,
          ...attributes,
          bbl: lookup.kind === "found" ? lookup.attributes.bbl : null,
          bin: lookup.kind === "found" ? lookup.attributes.bin : null,
          communityDistrict:
            lookup.kind === "found" ? lookup.attributes.communityDistrict : null,
          attributeSource: provenance(input, apartments.length, lookup),
        },
      });

      // --- The apartments, and what each one holds -------------------------
      const unitIds = new Map<string, string>();
      for (const apartment of apartments) {
        const unit = await tx.unit.create({
          data: {
            buildingId,
            label: apartment.label,
            floorIndex: apartment.floorIndex,
            line: apartment.line,
            unitType: "RESIDENTIAL",
          },
          select: { id: true },
        });
        unitIds.set(apartment.label, unit.id);

        await tx.shareAllocation.create({
          data: {
            buildingId,
            unitId: unit.id,
            shares: apartment.shares,
            effectiveFrom: joinedOn,
            note: FOUNDING_ALLOCATION_NOTE,
          },
        });
      }

      // --- The founder ------------------------------------------------------
      // President, because somebody has to be able to invite the rest of the
      // board, and shareholder because in a building this size the board is
      // the shareholders. Both are editable from the members page afterwards.
      const ownUnitId = input.ownLabel
        ? unitIds.get(input.ownLabel.toUpperCase())
        : null;

      const membership = await tx.membership.create({
        data: {
          buildingId,
          userId,
          roles: ownUnitId ? ["SHAREHOLDER", "PRESIDENT"] : ["PRESIDENT"],
          status: "ACTIVE",
          title: input.title?.trim() || "Board President",
          joinedOn,
        },
        select: { id: true },
      });

      if (ownUnitId) {
        await tx.membershipUnit.create({
          data: {
            buildingId,
            membershipId: membership.id,
            unitId: ownUnitId,
            relation: "OWNER",
          },
        });
      }

      // The attributes are confirmed, and this is the moment they were: a
      // person read every one of them on a screen and pressed the button. It
      // is recorded here rather than at `building.create` only because the
      // membership doing the vouching did not exist a few lines ago.
      await tx.building.update({
        where: { id: buildingId },
        data: {
          attributesConfirmedAt: new Date(),
          attributesConfirmedById: membership.id,
        },
      });

      // --- What the law says about a building shaped like this -------------
      // Every rule is assessed and every verdict recorded as PROPOSED. Nothing
      // reaches the calendar until the board confirms it on the rules page,
      // which is the point: a compliance calendar a machine filled in is a
      // calendar nobody owns.
      const summary = await assessBuilding(tx, buildingId, attributes);

      if (lookup.kind === "found") {
        await tx.buildingDataLookup.create({
          data: {
            buildingId,
            source: "pluto",
            query: lookup.matchedAddress,
            payload: lookup.payload as never,
          },
        });
      }

      await tx.auditLog.create({
        data: {
          buildingId,
          actorUserId: userId,
          actorMembershipId: membership.id,
          action: "building.found",
          entityType: "BUILDING",
          entityId: buildingId,
          after: {
            slug,
            name: input.name.trim(),
            apartments: apartments.length,
            attributeSource: provenance(input, apartments.length, lookup),
          },
          summary: `${input.name.trim()} set up with ${apartments.length} apartments.`,
        },
      });

      return ok({
        buildingId,
        slug,
        proposedRules: summary.created,
      });
    });
  } catch (error) {
    if (isSlugCollision(error)) return "slug-taken";
    throw error;
  }
}

/**
 * A unique violation, and specifically on the slug.
 *
 * Narrowed to the one constraint rather than treating every P2002 as a slug
 * clash: a duplicate apartment label reaching here would otherwise be retried
 * three times under different web addresses and then reported to the founder
 * as a naming problem, which would be a lie about a bug.
 *
 * The constraint name is read out of the driver adapter's own error rather
 * than from `meta.target`, which is the documented place and is empty here.
 * Prisma's driver adapters do not populate it — a P2002 raised through
 * `@prisma/adapter-pg` reports "Unique constraint failed on the (not
 * available)" and carries the real Postgres message underneath instead. The
 * `meta.target` branch stays for the day that changes.
 *
 * Shaped rather than `instanceof PrismaClientKnownRequestError`, because
 * importing the generated client here would cross the boundary
 * `tests/arch/no-direct-prisma.test.ts` exists to hold — and the boundary is
 * worth more than the narrower type. Nothing else in the process raises a
 * P2002 naming this constraint.
 *
 * This is precisely the kind of detail that rots quietly on an upgrade, so it
 * is pinned by a test that founds two buildings under one name and asserts
 * both end up openable.
 */
function isSlugCollision(error: unknown): boolean {
  if (field(error, "code") !== "P2002") return false;

  const meta = property(error, "meta");
  const target = property(meta, "target");
  const fields = Array.isArray(target) ? target : [target];
  if (fields.some((name) => typeof name === "string" && name.includes("slug"))) {
    return true;
  }

  const cause = property(property(meta, "driverAdapterError"), "cause");
  return /Building_slug_key/.test(field(cause, "originalMessage") ?? "");
}

function property(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

function field(value: unknown, key: string): string | undefined {
  const found = property(value, key);
  return typeof found === "string" ? found : undefined;
}

function attributesFrom(
  input: FoundBuildingInput,
  unitCount: number,
): BuildingAttributes {
  return {
    // The apartment list is the unit count. Asking for the number and then
    // asking for the apartments gives two sources for one fact, and they drift
    // the moment somebody adds a row — with the count feeding every
    // applicability predicate and the list feeding everything else.
    unitCount,
    stories: input.stories,
    yearBuilt: input.yearBuilt,
    grossSquareFeet: input.grossSquareFeet,
    hasElevator: input.hasElevator,
    gasService: input.gasService,
    oilTankPresent: input.oilTankPresent,
    sprinklerStatus: input.sprinklerStatus,
    facadeHeightFt: input.facadeHeightFt,
    isLandmarked: input.isLandmarked,
    hasParapet: input.hasParapet,
    ownerOccupied: true,
  };
}

/**
 * Where the building's attributes came from, decided by comparing what was
 * submitted against what the city says.
 *
 * `NYC_OPEN_DATA` means every attribute the city published was accepted
 * unchanged; `MIXED` means a human overrode at least one of them; `MANUAL`
 * means there was nothing to compare against. The distinction is not
 * bookkeeping — an attribute set nobody has vouched for produces a provisional
 * compliance assessment, and knowing which numbers a person actually looked at
 * is what makes that judgement possible three years later.
 */
function provenance(
  input: FoundBuildingInput,
  unitCount: number,
  lookup: Lookup,
): "MANUAL" | "NYC_OPEN_DATA" | "MIXED" {
  if (lookup.kind !== "found") return "MANUAL";

  const city = lookup.attributes;
  const comparisons: Array<[number | boolean | null, number | boolean | null]> = [
    [city.unitCount, unitCount],
    [city.stories, input.stories],
    [city.yearBuilt, input.yearBuilt],
    [city.grossSquareFeet, input.grossSquareFeet],
    [city.facadeHeightFt, input.facadeHeightFt],
    [city.isLandmarked, input.isLandmarked],
  ];

  // Only attributes the city actually published count. A null from PLUTO is
  // the absence of an opinion, and a founder typing a year the city never had
  // has overridden nothing.
  const published = comparisons.filter(([theirs]) => theirs !== null);
  if (published.length === 0) return "MANUAL";

  return published.every(([theirs, ours]) => theirs === ours)
    ? "NYC_OPEN_DATA"
    : "MIXED";
}

function validate(input: FoundBuildingInput): Result<never> | null {
  const fields: Record<string, string> = {};

  if (!input.name.trim()) fields["name"] = "What do you call the building?";
  if (!input.addressLine1.trim()) fields["addressLine1"] = "The street address.";
  if (!/^\d{5}$/.test(input.zip.trim())) fields["zip"] = "Five digits.";
  if (!Number.isInteger(input.stories) || input.stories < 1) {
    fields["stories"] = "How many floors, not counting a garden level?";
  }
  if (input.yearBuilt !== null && (input.yearBuilt < 1626 || input.yearBuilt > 2100)) {
    fields["yearBuilt"] = "That doesn't look like a year a building went up.";
  }

  const problems = checkApartments(input.apartments);
  const general = problems.find((problem) => problem.index === -1);
  if (general) fields["apartments"] = general.message;
  else if (problems.length > 0) {
    const first = problems[0];
    fields["apartments"] = first
      ? `Apartment ${first.index + 1}: ${first.message}`
      : "Check the apartments.";
  }

  if (
    input.ownLabel &&
    !input.apartments.some(
      (apartment) =>
        apartment.label.trim().toUpperCase() === input.ownLabel?.trim().toUpperCase(),
    )
  ) {
    fields["ownLabel"] = "Pick one of the apartments listed above.";
  }

  if (Object.keys(fields).length === 0) return null;
  return fail("invalid", "Some of this needs another look.", fields);
}
