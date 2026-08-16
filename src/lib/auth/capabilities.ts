import { Role } from "~/generated/prisma/enums";

/**
 * Roles say who someone is. Capabilities say what they may do. This file is the
 * only place the two are connected.
 *
 * Call sites check capabilities, never roles. When a building's house rules
 * turn out to be unusual — a treasurer who also handles alterations, a
 * secretary who runs the compliance calendar — the change happens here and
 * nowhere else.
 *
 * In a small co-op the board *is* the shareholders, so these sets overlap
 * heavily by design. Every active member can see the building's own
 * obligations; what officers add is the ability to decide, record and see
 * across units.
 */

export const CAPABILITIES = [
  // Building and membership
  "building.manage",
  "member.invite",
  "member.manage",
  "audit.view",

  // Compliance calendar
  "compliance.view",
  "compliance.manage",
  "compliance.markComplete",
  "compliance.assess",

  // Documents
  "document.viewAll",
  "document.viewOwnUnit",
  "document.upload",
  "document.delete",

  // Alterations
  "alteration.submit",
  "alteration.viewAll",
  "alteration.viewOwnUnit",
  "alteration.decide",
  "alteration.comment",
  "alteration.commentInternal",

  // Certificates of insurance
  "coi.view",
  "coi.manage",

  // Arrears and the ledger
  "arrears.viewAll",
  "arrears.viewOwnUnit",
  "arrears.recordPayment",
  "arrears.postCharge",
  "work.view",
  "work.manage",

  // Meetings
  "meeting.view",
  "meeting.manage",
  "proxy.submit",

  // Sublets
  "sublet.submit",
  "sublet.viewAll",
  "sublet.viewOwnUnit",
  "sublet.decide",

  // Bookings
  "booking.request",
  "booking.manage",

  // Repair tickets
  "ticket.create",
  "ticket.viewAll",
  "ticket.viewOwnUnit",
  "ticket.triage",
  "ticket.decideResponsibility",

  // Duty rotation
  "duty.view",
  "duty.manage",

  // Notices
  "notice.view",
  "notice.send",
] as const;

export type Capability = (typeof CAPABILITIES)[number];

/**
 * What any active member of the building gets, whatever else they are.
 *
 * The unit-scoped entries matter as much as the building-wide ones: a
 * shareholder may always see their *own* arrears and their *own* alteration
 * requests. Seeing a neighbour's is a separate capability, and giving it away
 * by accident is the single worst bug this product could ship.
 */
const BASE: readonly Capability[] = [
  "compliance.view",
  "document.viewOwnUnit",
  "alteration.submit",
  "alteration.viewOwnUnit",
  "alteration.comment",
  "coi.view",
  "arrears.viewOwnUnit",
  "meeting.view",
  "proxy.submit",
  "sublet.submit",
  "sublet.viewOwnUnit",
  "booking.request",
  "ticket.create",
  "ticket.viewOwnUnit",
  "duty.view",
  "notice.view",
  "document.upload",
  "work.view",
];

/** Everything an officer needs to run the building's records. */
const OFFICER: readonly Capability[] = [
  "compliance.manage",
  "compliance.markComplete",
  "compliance.assess",
  "document.viewAll",
  "alteration.viewAll",
  "alteration.decide",
  "alteration.commentInternal",
  "coi.manage",
  "meeting.manage",
  "sublet.viewAll",
  "sublet.decide",
  "booking.manage",
  "ticket.viewAll",
  "ticket.triage",
  "ticket.decideResponsibility",
  "duty.manage",
  "notice.send",
  "member.invite",
  "audit.view",
  "work.manage",
];

const BY_ROLE: Record<Role, readonly Capability[]> = {
  [Role.SHAREHOLDER]: BASE,

  [Role.PRESIDENT]: [
    ...BASE,
    ...OFFICER,
    "building.manage",
    "member.manage",
    "arrears.viewAll",
  ],

  // The treasurer is the only officer who sees every unit's arrears by default.
  // In a twelve-unit building that is one person, and it should stay one
  // person: who is behind on maintenance is the most socially explosive fact
  // the system holds.
  [Role.TREASURER]: [
    ...BASE,
    ...OFFICER,
    "arrears.viewAll",
    "arrears.recordPayment",
    "arrears.postCharge",
  ],

  [Role.SECRETARY]: [...BASE, ...OFFICER, "member.manage"],

  [Role.BOARD_MEMBER]: [...BASE, ...OFFICER],

  // The super keeps the building running and needs the work, not the money or
  // the governance. Note the absence of every arrears and meeting capability.
  [Role.SUPER]: [
    "compliance.view",
    "compliance.markComplete",
    "document.viewAll",
    "document.upload",
    "coi.view",
    "ticket.create",
    "ticket.viewAll",
    "ticket.triage",
    "duty.view",
    "duty.manage",
    "booking.manage",
    "alteration.viewAll",
  ],

  // Managing agents, an outgoing treasurer mid-handover, a board's accountant.
  // Reads the building-wide record, changes nothing, sees no unit's ledger.
  [Role.OBSERVER]: ["compliance.view", "meeting.view", "notice.view", "duty.view"],
};

/** Resolves the full capability set for a set of roles. */
export function capabilitiesFor(roles: readonly Role[]): Set<Capability> {
  const out = new Set<Capability>();
  for (const role of roles) {
    for (const capability of BY_ROLE[role] ?? []) {
      out.add(capability);
    }
  }
  return out;
}

/** Anything that carries a resolved capability set — in practice, BuildingContext. */
export interface HasCapabilities {
  readonly capabilities: ReadonlySet<Capability>;
}

/** The check every call site uses. */
export function can(ctx: HasCapabilities, capability: Capability): boolean {
  return ctx.capabilities.has(capability);
}

/**
 * Throws unless the capability is held. For Server Actions, prefer returning a
 * typed failure — see `src/lib/result.ts` — so the UI can say something useful
 * instead of rendering an error boundary.
 */
export function assertCan(ctx: HasCapabilities, capability: Capability): void {
  if (!can(ctx, capability)) {
    throw new CapabilityError(capability);
  }
}

export class CapabilityError extends Error {
  readonly capability: Capability;

  constructor(capability: Capability) {
    super(`Missing capability: ${capability}`);
    this.name = "CapabilityError";
    this.capability = capability;
  }
}
