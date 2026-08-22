import { assertCan } from "~/lib/auth/capabilities";
import {
  computeQuorum,
  fractionThreshold,
  resolutionPassed,
  totalShares,
  type QuorumResult,
  type ShareHolding,
  type Threshold,
} from "~/lib/primitives/shares";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";

/**
 * Meetings, proxies and resolutions.
 *
 * Building-wide reads, like the compliance calendar and unlike arrears. Who
 * attended the annual meeting and how the building voted is the corporate
 * record; a shareholder who could not see it would have no way to check that
 * the resolution binding them was carried at all.
 *
 * Everything here is share-weighted. Quorum is not "seven of twelve turned up",
 * it is "the units present hold two-thirds of the shares", and in a building
 * where four apartments hold sixty per cent of the stock those two sentences
 * routinely disagree. The arithmetic lives in `src/lib/primitives/shares.ts`
 * and is exact — nothing is divided or rounded between the bylaws and the
 * result — so this module's job is to feed it the right rows.
 */

const MEETING_SELECT = {
  id: true,
  buildingId: true,
  title: true,
  type: true,
  scheduledFor: true,
  location: true,
  agenda: true,
  quorumNumerator: true,
  quorumDenominator: true,
  quorumStrict: true,
  heldAt: true,
  minutes: true,
  minutesAdoptedAt: true,
  minutesDocumentId: true,
  createdAt: true,
  minutesAdopted: { select: { user: { select: { name: true, email: true } } } },
  createdBy: { select: { user: { select: { name: true, email: true } } } },
} as const;

const ATTENDANCE_SELECT = {
  id: true,
  unitId: true,
  mode: true,
  representedBy: true,
  recordedAt: true,
  unit: { select: { id: true, label: true } },
} as const;

const PROXY_SELECT = {
  id: true,
  unitId: true,
  holderId: true,
  holderName: true,
  evidence: true,
  grantedAt: true,
  revokedAt: true,
  unit: { select: { id: true, label: true } },
  holder: { select: { user: { select: { name: true, email: true } } } },
} as const;

const RESOLUTION_SELECT = {
  id: true,
  meetingId: true,
  title: true,
  text: true,
  sharesFor: true,
  sharesAgainst: true,
  sharesAbstain: true,
  passed: true,
  thresholdNumerator: true,
  thresholdDenominator: true,
  thresholdStrict: true,
  basis: true,
  recordedAt: true,
  createdAt: true,
  recordedBy: { select: { user: { select: { name: true, email: true } } } },
  votes: {
    orderBy: { shares: "desc" },
    select: {
      id: true,
      unitId: true,
      choice: true,
      shares: true,
      byProxy: true,
      unit: { select: { id: true, label: true } },
    },
  },
} as const;

export async function listMeetings(ctx: BuildingContext) {
  assertCan(ctx, "meeting.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.meeting.findMany({
      orderBy: { scheduledFor: "desc" },
      select: {
        ...MEETING_SELECT,
        _count: { select: { attendance: true, proxies: true, resolutions: true } },
      },
    }),
  );
}

/**
 * One meeting with everything hanging off it, in a single transaction.
 *
 * Attendance, proxies and resolutions are read together rather than by separate
 * calls because the quorum is computed from all three, and reading them across
 * three transactions means a proxy granted between the first and the second
 * produces a quorum figure that was never true at any instant.
 */
export async function getMeeting(ctx: BuildingContext, meetingId: string) {
  assertCan(ctx, "meeting.view");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const meeting = await tx.meeting.findUnique({
      where: { id: meetingId },
      select: MEETING_SELECT,
    });
    if (!meeting) return null;

    const [attendance, proxies, resolutions, workDecisions] = await Promise.all([
      tx.meetingAttendance.findMany({
        where: { meetingId },
        orderBy: { recordedAt: "asc" },
        select: ATTENDANCE_SELECT,
      }),
      tx.proxy.findMany({
        where: { meetingId },
        orderBy: { grantedAt: "desc" },
        select: PROXY_SELECT,
      }),
      tx.resolution.findMany({
        where: { meetingId },
        orderBy: { createdAt: "asc" },
        select: RESOLUTION_SELECT,
      }),
      // Decisions on building work that were taken at this meeting. A board's
      // vote to spend $48,000 belongs in the minutes of the meeting that took
      // it, not only on the page of the job it paid for.
      tx.buildingWork.findMany({
        where: { decisionMeetingId: meetingId },
        orderBy: { decisionAt: "asc" },
        select: {
          id: true,
          title: true,
          decisionFor: true,
          decisionAgainst: true,
          decisionAbstain: true,
          estimateCents: true,
          assessmentTotalCents: true,
        },
      }),
    ]);

    return { ...meeting, attendance, proxies, resolutions, workDecisions };
  });
}

/** Meetings a board decision can be attached to. Recent first, and few. */
export async function listMeetingsForPicker(ctx: BuildingContext) {
  assertCan(ctx, "meeting.view");

  return withBuildingTx(ctx.building.id, (tx) =>
    tx.meeting.findMany({
      orderBy: { scheduledFor: "desc" },
      take: 24,
      select: { id: true, title: true, scheduledFor: true, type: true },
    }),
  );
}

export type MeetingDetail = NonNullable<Awaited<ReturnType<typeof getMeeting>>>;
export type MeetingProxy = MeetingDetail["proxies"][number];
export type MeetingResolution = MeetingDetail["resolutions"][number];

/** The quorum fraction a meeting was called under. */
export function quorumThreshold(meeting: {
  quorumNumerator: number;
  quorumDenominator: number;
  quorumStrict: boolean;
}): Threshold {
  return fractionThreshold(
    meeting.quorumNumerator,
    meeting.quorumDenominator,
    meeting.quorumStrict,
  );
}

/** The threshold a resolution had to clear. */
export function resolutionThreshold(resolution: {
  thresholdNumerator: number;
  thresholdDenominator: number;
  thresholdStrict: boolean;
}): Threshold {
  return fractionThreshold(
    resolution.thresholdNumerator,
    resolution.thresholdDenominator,
    resolution.thresholdStrict,
  );
}

/** Proxies that have not been revoked, newest grant per unit winning. */
export function liveProxies(proxies: readonly MeetingProxy[]): MeetingProxy[] {
  const byUnit = new Map<string, MeetingProxy>();
  for (const proxy of proxies) {
    if (proxy.revokedAt) continue;
    const existing = byUnit.get(proxy.unitId);
    if (!existing || proxy.grantedAt > existing.grantedAt)
      byUnit.set(proxy.unitId, proxy);
  }
  return [...byUnit.values()];
}

/**
 * Quorum for a meeting, from its attendance and its live proxies.
 *
 * A unit marked present *and* holding a live proxy counts once — the primitive
 * handles that, and it is not hypothetical: a shareholder sends a proxy, then
 * turns up anyway, and double-counting inflates the quorum that authorised
 * every resolution passed that night.
 */
export function quorumFor(input: {
  meeting: {
    quorumNumerator: number;
    quorumDenominator: number;
    quorumStrict: boolean;
  };
  attendance: ReadonlyArray<{ unitId: string; mode: string }>;
  proxies: readonly MeetingProxy[];
  holdings: readonly ShareHolding[];
}): QuorumResult {
  return computeQuorum({
    holdings: input.holdings,
    // A unit whose only representation is a proxy is recorded as attending in
    // PROXY mode by the write path, so counting it as in-person here would
    // report the room as fuller than it was.
    presentUnitIds: input.attendance
      .filter((row) => row.mode !== "PROXY")
      .map((row) => row.unitId),
    proxyUnitIds: [
      ...liveProxies(input.proxies).map((proxy) => proxy.unitId),
      ...input.attendance
        .filter((row) => row.mode === "PROXY")
        .map((row) => row.unitId),
    ],
    threshold: quorumThreshold(input.meeting),
  });
}

export interface ResolutionOutcome {
  readonly passed: boolean;
  readonly threshold: Threshold;
  /** The share count the threshold was measured against. */
  readonly denominator: number;
  readonly needed: number;
}

/**
 * Recomputes a resolution's outcome from its stored tally.
 *
 * Deliberately recomputed rather than trusted: `passed` is a stored boolean and
 * this is the arithmetic that put it there, so a page rendering both is a page
 * that would show a disagreement rather than hide one.
 */
export function outcomeOf(
  resolution: {
    sharesFor: number;
    sharesAgainst: number;
    sharesAbstain: number;
    thresholdNumerator: number;
    thresholdDenominator: number;
    thresholdStrict: boolean;
    basis: "VOTED" | "PRESENT" | "OUTSTANDING";
  },
  totalOutstanding: number,
): ResolutionOutcome {
  const threshold = resolutionThreshold(resolution);
  const tally = {
    sharesFor: resolution.sharesFor,
    sharesAgainst: resolution.sharesAgainst,
    sharesAbstain: resolution.sharesAbstain,
  };

  const base =
    resolution.basis === "VOTED"
      ? "voted"
      : resolution.basis === "PRESENT"
        ? "present"
        : "outstanding";

  const denominator =
    base === "voted"
      ? tally.sharesFor + tally.sharesAgainst
      : base === "present"
        ? tally.sharesFor + tally.sharesAgainst + tally.sharesAbstain
        : totalOutstanding;

  const exact = (denominator * threshold.numerator) / threshold.denominator;

  return {
    passed: resolutionPassed(tally, threshold, base, totalOutstanding),
    threshold,
    denominator,
    needed: threshold.strict ? Math.floor(exact) + 1 : Math.ceil(exact),
  };
}

/** Total shares in the building as of a date, for the quorum denominator. */
export function buildingShares(
  units: ReadonlyArray<{ id: string; shares: number }>,
): number {
  return totalShares(units.map((unit) => ({ unitId: unit.id, shares: unit.shares })));
}

/** Unfiltered reads used by the tenancy suite. */

export async function listMeetingsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.meeting.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listAttendanceForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.meetingAttendance.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listProxiesForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.proxy.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listResolutionsForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.resolution.findMany({ select: { id: true, buildingId: true } }),
  );
}

export async function listResolutionVotesForTenancyCheck(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, (tx) =>
    tx.resolutionVote.findMany({ select: { id: true, buildingId: true } }),
  );
}
