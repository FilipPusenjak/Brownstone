import type { Role } from "~/generated/prisma/enums";

/**
 * How roles are written down for people.
 *
 * The enum is SCREAMING_SNAKE because Postgres wants it that way; a board
 * member reading "BOARD_MEMBER" on their own page is the database leaking into
 * the room. One place for the mapping, so the email, the member list and the
 * invitation form never drift apart.
 */

const NAMES: Record<Role, string> = {
  SHAREHOLDER: "shareholder",
  PRESIDENT: "president",
  TREASURER: "treasurer",
  SECRETARY: "secretary",
  BOARD_MEMBER: "board member",
  SUPER: "superintendent",
  OBSERVER: "observer",
};

export function roleLabel(role: Role): string {
  return NAMES[role] ?? role.toLowerCase().replaceAll("_", " ");
}

/** "president and shareholder" — for a sentence, not a table cell. */
export function describeRoles(roles: readonly Role[]): string {
  const names = roles.map(roleLabel);
  if (names.length === 0) return "a member";
  if (names.length === 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * The one role worth putting beside a name.
 *
 * Everyone is a shareholder, so saying so tells a reader nothing; the officer
 * role is the useful part. Someone who is only a shareholder keeps that label.
 */
export function primaryRole(roles: readonly Role[]): string {
  const officer = roles.find((role) => role !== "SHAREHOLDER");
  return roleLabel(officer ?? "SHAREHOLDER");
}
