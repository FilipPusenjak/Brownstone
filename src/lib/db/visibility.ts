import type { Capability, HasCapabilities } from "~/lib/auth/capabilities";
import { can } from "~/lib/auth/capabilities";

/**
 * The second scoping tier.
 *
 * Tenant isolation decides which *building* you can see. This decides which
 * *units within it* you can see, and it is where the product's trustworthiness
 * actually lives. A shareholder learning which neighbour is three months behind
 * on maintenance is a real harm and a real lawsuit.
 *
 * The design goal is that unit scoping is the path of least resistance. Scoped
 * query modules call `unitFilter` and spread the result into their `where`;
 * getting it wrong takes more typing than getting it right.
 */

export interface HasUnits {
  readonly unitIds: readonly string[];
}

export type VisibilityContext = HasCapabilities & HasUnits;

export type Visibility =
  | { readonly scope: "all" }
  | { readonly scope: "units"; readonly unitIds: readonly string[] }
  | { readonly scope: "none" };

/**
 * Domains with a building-wide tier and a unit-scoped tier. Adding one means
 * naming both capabilities here rather than writing a conditional at the call
 * site.
 */
const DOMAINS = {
  arrears: ["arrears.viewAll", "arrears.viewOwnUnit"],
  alteration: ["alteration.viewAll", "alteration.viewOwnUnit"],
  ticket: ["ticket.viewAll", "ticket.viewOwnUnit"],
  sublet: ["sublet.viewAll", "sublet.viewOwnUnit"],
  document: ["document.viewAll", "document.viewOwnUnit"],
} as const satisfies Record<string, readonly [Capability, Capability]>;

export type VisibilityDomain = keyof typeof DOMAINS;

/** What this member may see in a domain: everything, their own units, or nothing. */
export function visibility(
  ctx: VisibilityContext,
  domain: VisibilityDomain,
): Visibility {
  const [viewAll, viewOwn] = DOMAINS[domain];

  if (can(ctx, viewAll)) return { scope: "all" };
  if (can(ctx, viewOwn)) return { scope: "units", unitIds: [...ctx.unitIds] };
  return { scope: "none" };
}

/**
 * A Prisma `where` fragment for a model with a `unitId` column.
 *
 *   where: { ...unitFilter(ctx, "arrears"), dueOn: { lte: today } }
 *
 * A member with no units and no building-wide capability yields
 * `{ unitId: { in: [] } }`, which matches nothing. Returning `{}` there — an
 * easy mistake — would show them every unit in the building.
 */
export function unitFilter(
  ctx: VisibilityContext,
  domain: VisibilityDomain,
): { unitId?: { in: string[] } } {
  const v = visibility(ctx, domain);

  switch (v.scope) {
    case "all":
      return {};
    case "units":
      return { unitId: { in: [...v.unitIds] } };
    case "none":
      return { unitId: { in: [] } };
  }
}

/**
 * Same as `unitFilter` for models whose unit link is nullable — repair tickets
 * for the stoop or the boiler room belong to no unit.
 *
 * Building-wide records stay visible to everyone, because a broken front door
 * is everyone's business; unit-linked ones follow the usual rule.
 */
export function optionalUnitFilter(
  ctx: VisibilityContext,
  domain: VisibilityDomain,
): { OR?: Array<{ unitId: null } | { unitId: { in: string[] } }> } {
  const v = visibility(ctx, domain);

  if (v.scope === "all") return {};
  const unitIds = v.scope === "units" ? [...v.unitIds] : [];
  return { OR: [{ unitId: null }, { unitId: { in: unitIds } }] };
}

/** Whether a specific unit's records are visible to this member. */
export function canSeeUnit(
  ctx: VisibilityContext,
  domain: VisibilityDomain,
  unitId: string,
): boolean {
  const v = visibility(ctx, domain);
  if (v.scope === "all") return true;
  if (v.scope === "none") return false;
  return v.unitIds.includes(unitId);
}
