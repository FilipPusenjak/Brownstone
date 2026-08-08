import type { MembershipStatus, Role } from "~/generated/prisma/enums";
import type { Capability } from "~/lib/auth/capabilities";
import { capabilitiesFor } from "~/lib/auth/capabilities";
import { withMemberBootstrapTx } from "./tx";

/**
 * BuildingContext — the only key to the data.
 *
 * Holding one means: this person is signed in, this building exists, they are
 * an active member of it, and these are the capabilities and units that
 * membership grants. Every scoped query takes one as its first argument, so
 * there is no way to read building data without having proved all of that
 * first.
 *
 * It is resolved once per request, in `app/b/[buildingSlug]/layout.tsx`, and
 * memoised for the render pass by React's `cache`. That matters for ergonomics:
 * a page and three components can each ask for the context without three round
 * trips, so nobody is tempted to thread it manually or reach past it.
 */

export interface ContextUser {
  readonly id: string;
  readonly email: string;
  readonly name: string | null;
}

export interface ContextBuilding {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly addressLine1: string;
  readonly timezone: string;
  readonly unitCount: number;
  readonly floorNaming: "BROWNSTONE" | "NUMERIC";
  readonly attributesConfirmedAt: Date | null;
}

export interface ContextMembership {
  readonly id: string;
  readonly roles: readonly Role[];
  readonly status: MembershipStatus;
  readonly title: string | null;
}

export interface BuildingContext {
  readonly user: ContextUser;
  readonly building: ContextBuilding;
  readonly membership: ContextMembership;
  /** Units this member holds or occupies. Drives every unit-scoped read. */
  readonly unitIds: readonly string[];
  readonly capabilities: ReadonlySet<Capability>;
}

/** A building this user belongs to, for the switcher. Rare, but real. */
export interface MemberBuilding {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
}

export class NotSignedInError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "NotSignedInError";
  }
}

export class NoSuchBuildingError extends Error {
  readonly slug: string;
  constructor(slug: string) {
    super(`No building at ${slug}, or you are not a member of it`);
    this.name = "NoSuchBuildingError";
    this.slug = slug;
  }
}

/**
 * Resolves a context for an already-known user id.
 *
 * Separated from the session lookup so tests can build a context for a seeded
 * user without standing up an HTTP session — and so that the tenancy suite
 * exercises exactly the resolver the app uses, rather than a test-only stub
 * that could drift away from it.
 */
export const resolveBuildingContext = async (
  userId: string,
  buildingSlug: string,
): Promise<BuildingContext> =>
  withMemberBootstrapTx(userId, async (tx, scope) => {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });
    if (!user) throw new NotSignedInError();

    // Only ACTIVE memberships. Someone who sold their apartment in March keeps
    // their account and loses the building the same day.
    const memberships = await tx.membership.findMany({
      where: { userId, status: "ACTIVE" },
      select: {
        id: true,
        buildingId: true,
        roles: true,
        status: true,
        title: true,
      },
    });
    if (memberships.length === 0) throw new NoSuchBuildingError(buildingSlug);

    await scope.allowBuildings(memberships.map((m) => m.buildingId));

    const building = await tx.building.findUnique({
      where: { slug: buildingSlug },
      select: {
        id: true,
        slug: true,
        name: true,
        addressLine1: true,
        timezone: true,
        unitCount: true,
        floorNaming: true,
        attributesConfirmedAt: true,
      },
    });
    if (!building) throw new NoSuchBuildingError(buildingSlug);

    const membership = memberships.find((m) => m.buildingId === building.id);
    if (!membership) throw new NoSuchBuildingError(buildingSlug);

    await scope.enterBuilding(building.id);

    const held = await tx.membershipUnit.findMany({
      where: { membershipId: membership.id },
      select: { unitId: true },
    });

    return {
      user,
      building,
      membership: {
        id: membership.id,
        roles: membership.roles,
        status: membership.status,
        title: membership.title,
      },
      unitIds: held.map((h) => h.unitId),
      capabilities: capabilitiesFor(membership.roles),
    } satisfies BuildingContext;
  });

/** Every building this user is an active member of. Powers the switcher. */
export const memberBuildings = async (userId: string): Promise<MemberBuilding[]> =>
  withMemberBootstrapTx(userId, async (tx, scope) => {
    const memberships = await tx.membership.findMany({
      where: { userId, status: "ACTIVE" },
      select: { buildingId: true },
    });
    if (memberships.length === 0) return [];

    await scope.allowBuildings(memberships.map((m) => m.buildingId));

    return tx.building.findMany({
      where: { id: { in: memberships.map((m) => m.buildingId) } },
      select: { id: true, slug: true, name: true },
      orderBy: { name: "asc" },
    });
  });

// Resolution deliberately stops here, at "given a user id and a slug".
// Reading the id out of an HTTP session lives in src/lib/auth/current.ts, so
// this module — and the tenancy suite that exercises it — stays free of
// next-auth and the request lifecycle. The property being proved is about the
// database, not about cookies.
