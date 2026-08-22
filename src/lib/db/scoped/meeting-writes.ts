import type { AttendanceMode, MeetingType, VoteChoice } from "~/generated/prisma/enums";
import { assertCan, can } from "~/lib/auth/capabilities";
import { computeQuorum, fractionThreshold } from "~/lib/primitives/shares";
import { fail, ok, type Failure, type Result } from "~/lib/result";
import { toPlainDate, type PlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx, type ScopedTx } from "../tx";
import { recordAudit } from "./audit";

/**
 * Writing down what a meeting did.
 *
 * The module records; it does not run the meeting. Nobody casts a ballot in a
 * browser, there is no live voting session, and the software never decides
 * anything — a chair calls the vote in a room and a secretary writes down what
 * happened. What the software is for is the arithmetic nobody can do in their
 * head, and the two or three rules a tired secretary at 10pm will otherwise get
 * wrong.
 *
 * Those rules, in order of how much trouble they save:
 *
 * 1. **No business without quorum.** A resolution recorded at an inquorate
 *    meeting is void, and finding that out three years later — when someone
 *    challenges the assessment it authorised — is the expensive way. Attendance
 *    is recorded first, and the vote is refused until the shares in the room
 *    clear the bylaw fraction.
 * 2. **Only those present may vote.** Including by proxy, and a vote marked as
 *    cast by proxy has to have a live proxy behind it.
 * 3. **Adoption freezes the record.** Once the board adopts the minutes, the
 *    meeting is closed: no more attendance, no more proxies, no more
 *    resolutions, no more edits to the minutes themselves.
 *
 * Everything is share-weighted, and share counts are read as of the meeting
 * date and then frozen onto the rows. A transfer next spring must not restate
 * what last autumn's meeting decided.
 */

const MAX_TEXT = 20_000;

/** The record is closed once the board has adopted the minutes. */
async function openMeeting(
  tx: ScopedTx,
  meetingId: string,
): Promise<
  | { ok: true; meeting: { id: string; title: string; scheduledFor: Date } }
  | { ok: false; failure: Failure }
> {
  const meeting = await tx.meeting.findUnique({
    where: { id: meetingId },
    select: { id: true, title: true, scheduledFor: true, minutesAdoptedAt: true },
  });

  if (!meeting) {
    return {
      ok: false,
      failure: fail("not_found", "That meeting could not be found."),
    };
  }
  if (meeting.minutesAdoptedAt) {
    return {
      ok: false,
      failure: fail(
        "conflict",
        "The board has adopted the minutes for this meeting, so its record is closed. A correction has to be made at the next meeting and minuted there.",
      ),
    };
  }

  return {
    ok: true,
    meeting: {
      id: meeting.id,
      title: meeting.title,
      scheduledFor: meeting.scheduledFor,
    },
  };
}

/**
 * The share register as of a date, read inside the caller's transaction.
 *
 * Not `listUnitsWithShares`, which opens its own — a quorum computed in one
 * transaction and a vote written in another can disagree, and the disagreement
 * would be invisible.
 */
async function sharesAsOf(
  tx: ScopedTx,
  asOf: PlainDate,
): Promise<Array<{ unitId: string; label: string; shares: number }>> {
  const on = new Date(`${asOf}T00:00:00.000Z`);

  const units = await tx.unit.findMany({
    orderBy: [{ floorIndex: "asc" }, { label: "asc" }],
    select: {
      id: true,
      label: true,
      shareAllocations: {
        where: {
          effectiveFrom: { lte: on },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: on } }],
        },
        orderBy: { effectiveFrom: "desc" },
        take: 1,
        select: { shares: true },
      },
    },
  });

  return units.map((unit) => ({
    unitId: unit.id,
    label: unit.label,
    shares: unit.shareAllocations[0]?.shares ?? 0,
  }));
}

function checkFraction(
  numerator: number,
  denominator: number,
  field: string,
): Failure | null {
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator)) {
    return fail("invalid", "A threshold has to be a whole fraction.", {
      [field]: "Two-thirds is 2 and 3, not 0.667.",
    });
  }
  if (denominator <= 0 || numerator <= 0 || numerator > denominator) {
    return fail("invalid", "That threshold cannot be met by anyone.", {
      [field]: "The top of the fraction has to be between 1 and the bottom.",
    });
  }
  return null;
}

// --- Scheduling ------------------------------------------------------------

export interface ScheduleMeetingInput {
  readonly title: string;
  readonly type: MeetingType;
  readonly scheduledFor: Date;
  readonly location?: string | null;
  readonly agenda?: string | null;
  readonly quorumNumerator?: number;
  readonly quorumDenominator?: number;
  readonly quorumStrict?: boolean;
}

export async function scheduleMeeting(
  ctx: BuildingContext,
  input: ScheduleMeetingInput,
): Promise<Result<{ meetingId: string }>> {
  assertCan(ctx, "meeting.manage");

  const title = input.title.trim();
  if (title.length < 3) {
    return fail("invalid", "Give the meeting a name.", {
      title: "“2026 annual shareholders meeting” is enough.",
    });
  }
  if (Number.isNaN(input.scheduledFor.getTime())) {
    return fail("invalid", "That date and time could not be read.", {
      scheduledFor: "Pick when the meeting is.",
    });
  }

  const numerator = input.quorumNumerator ?? 1;
  const denominator = input.quorumDenominator ?? 2;
  const bad = checkFraction(numerator, denominator, "quorumNumerator");
  if (bad) return bad;

  return withBuildingTx(ctx.building.id, async (tx) => {
    const meeting = await tx.meeting.create({
      data: {
        buildingId: ctx.building.id,
        title,
        type: input.type,
        scheduledFor: input.scheduledFor,
        location: input.location?.trim() || null,
        agenda: input.agenda?.trim() || null,
        quorumNumerator: numerator,
        quorumDenominator: denominator,
        quorumStrict: input.quorumStrict ?? (numerator === 1 && denominator === 2),
        createdById: ctx.membership.id,
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "meeting.schedule",
      entityType: "MEETING",
      entityId: meeting.id,
      after: {
        title,
        type: input.type,
        scheduledFor: input.scheduledFor.toISOString(),
        quorum: `${numerator}/${denominator}`,
      },
      summary: `${title} called for ${input.scheduledFor.toISOString().slice(0, 10)}`,
    });

    return ok({ meetingId: meeting.id });
  });
}

export interface UpdateMeetingInput {
  readonly title?: string;
  readonly scheduledFor?: Date;
  readonly location?: string | null;
  readonly agenda?: string | null;
  readonly heldAt?: Date | null;
}

export async function updateMeeting(
  ctx: BuildingContext,
  meetingId: string,
  input: UpdateMeetingInput,
): Promise<Result<null>> {
  assertCan(ctx, "meeting.manage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const gate = await openMeeting(tx, meetingId);
    if (!gate.ok) return gate.failure;

    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.scheduledFor !== undefined
          ? { scheduledFor: input.scheduledFor }
          : {}),
        ...(input.location !== undefined
          ? { location: input.location?.trim() || null }
          : {}),
        ...(input.agenda !== undefined ? { agenda: input.agenda?.trim() || null } : {}),
        ...(input.heldAt !== undefined ? { heldAt: input.heldAt } : {}),
      },
    });

    await recordAudit(tx, ctx, {
      action: "meeting.update",
      entityType: "MEETING",
      entityId: meetingId,
      after: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.heldAt !== undefined
          ? { heldAt: input.heldAt?.toISOString() ?? null }
          : {}),
      },
      summary:
        input.heldAt !== undefined
          ? `${gate.meeting.title} marked as ${input.heldAt ? "held" : "not yet held"}`
          : `${gate.meeting.title} updated`,
    });

    return ok(null);
  });
}

// --- Attendance ------------------------------------------------------------

export interface RecordAttendanceInput {
  readonly unitId: string;
  readonly mode: AttendanceMode;
  readonly representedBy?: string | null;
}

/**
 * Marks an apartment present, or changes how it is present.
 *
 * Written as an upsert on (meeting, unit) because a secretary at the door
 * corrects themselves — the apartment arrives in person after sending a proxy,
 * or someone joins by video partway through — and a second row for the same
 * apartment would count its shares twice.
 */
export async function recordAttendance(
  ctx: BuildingContext,
  meetingId: string,
  input: RecordAttendanceInput,
): Promise<Result<{ attendanceId: string }>> {
  assertCan(ctx, "meeting.manage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const gate = await openMeeting(tx, meetingId);
    if (!gate.ok) return gate.failure;

    const unit = await tx.unit.findUnique({
      where: { id: input.unitId },
      select: { id: true, label: true },
    });
    if (!unit) return fail("not_found", "That apartment could not be found.");

    const row = await tx.meetingAttendance.upsert({
      where: { meetingId_unitId: { meetingId, unitId: unit.id } },
      create: {
        buildingId: ctx.building.id,
        meetingId,
        unitId: unit.id,
        mode: input.mode,
        representedBy: input.representedBy?.trim() || null,
        recordedById: ctx.membership.id,
      },
      update: {
        mode: input.mode,
        ...(input.representedBy !== undefined
          ? { representedBy: input.representedBy?.trim() || null }
          : {}),
        recordedById: ctx.membership.id,
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "meeting.recordAttendance",
      entityType: "MEETING",
      entityId: meetingId,
      after: { unit: unit.label, mode: input.mode },
      summary: `${unit.label} recorded present at ${gate.meeting.title}`,
    });

    return ok({ attendanceId: row.id });
  });
}

/** Marks an apartment absent again, when it was recorded present by mistake. */
export async function clearAttendance(
  ctx: BuildingContext,
  meetingId: string,
  unitId: string,
): Promise<Result<null>> {
  assertCan(ctx, "meeting.manage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const gate = await openMeeting(tx, meetingId);
    if (!gate.ok) return gate.failure;

    const existing = await tx.meetingAttendance.findUnique({
      where: { meetingId_unitId: { meetingId, unitId } },
      select: { id: true, unit: { select: { label: true } } },
    });
    if (!existing) return ok(null);

    // A unit that has already voted was in the room. Removing it from the
    // attendance list would leave a vote cast by an apartment the record says
    // was not there.
    const voted = await tx.resolutionVote.count({
      where: { unitId, resolution: { meetingId } },
    });
    if (voted > 0) {
      return fail(
        "conflict",
        `${existing.unit.label} has already voted on a resolution at this meeting, so it cannot be marked absent.`,
      );
    }

    await tx.meetingAttendance.delete({ where: { id: existing.id } });

    await recordAudit(tx, ctx, {
      action: "meeting.clearAttendance",
      entityType: "MEETING",
      entityId: meetingId,
      before: { unit: existing.unit.label },
      summary: `${existing.unit.label} marked absent from ${gate.meeting.title}`,
    });

    return ok(null);
  });
}

// --- Proxies ---------------------------------------------------------------

export interface GrantProxyInput {
  readonly unitId: string;
  readonly holderName: string;
  /** The membership holding it, when the holder is another member. */
  readonly holderId?: string | null;
  /** How the grant was captured — a signed form, an email, a phone call. */
  readonly evidence?: string | null;
}

/**
 * Records a proxy: apartment 4R authorises someone else to represent it.
 *
 * A shareholder may grant one for their own apartment; recording one for a
 * neighbour takes `meeting.manage`, because a proxy nobody granted is how a
 * vote gets stolen. Granting supersedes any live proxy for the same apartment
 * rather than replacing it, so the earlier grant stays on the record — "who
 * held my proxy that night" is exactly the question asked when a vote is
 * contested.
 */
export async function grantProxy(
  ctx: BuildingContext,
  meetingId: string,
  input: GrantProxyInput,
): Promise<Result<{ proxyId: string }>> {
  const ownUnit = ctx.unitIds.includes(input.unitId);
  if (!ownUnit) {
    // Not `proxy.submit`: that is the capability to give away *your* vote.
    assertCan(ctx, "meeting.manage");
  } else {
    assertCan(ctx, "proxy.submit");
  }

  const holderName = input.holderName.trim();
  if (holderName.length < 2) {
    return fail("invalid", "Say who is holding the proxy.", {
      holderName: "A name, as it should appear in the minutes.",
    });
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const gate = await openMeeting(tx, meetingId);
    if (!gate.ok) return gate.failure;

    const unit = await tx.unit.findUnique({
      where: { id: input.unitId },
      select: { id: true, label: true },
    });
    if (!unit) return fail("not_found", "That apartment could not be found.");

    if (input.holderId) {
      const holder = await tx.membership.findUnique({
        where: { id: input.holderId },
        select: { id: true, status: true },
      });
      if (!holder || holder.status !== "ACTIVE") {
        return fail("not_found", "That proxy holder is not an active member.");
      }
    }

    // At most one live proxy per apartment. Superseding rather than editing
    // keeps both grants readable.
    const superseded = await tx.proxy.updateMany({
      where: { meetingId, unitId: unit.id, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: ctx.membership.id },
    });

    const proxy = await tx.proxy.create({
      data: {
        buildingId: ctx.building.id,
        meetingId,
        unitId: unit.id,
        holderId: input.holderId ?? null,
        holderName,
        evidence: input.evidence?.trim() || null,
        grantedById: ctx.membership.id,
      },
      select: { id: true },
    });

    // The apartment is represented, so it counts toward quorum. Recorded as
    // attending in PROXY mode unless it is already down as being in the room,
    // which outranks the proxy.
    const present = await tx.meetingAttendance.findUnique({
      where: { meetingId_unitId: { meetingId, unitId: unit.id } },
      select: { id: true },
    });
    if (!present) {
      await tx.meetingAttendance.create({
        data: {
          buildingId: ctx.building.id,
          meetingId,
          unitId: unit.id,
          mode: "PROXY",
          representedBy: holderName,
          recordedById: ctx.membership.id,
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: "meeting.grantProxy",
      entityType: "MEETING",
      entityId: meetingId,
      after: { unit: unit.label, holderName, superseded: superseded.count },
      summary: `${unit.label} gave its proxy to ${holderName} for ${gate.meeting.title}`,
    });

    return ok({ proxyId: proxy.id });
  });
}

/**
 * Revokes a proxy. The shareholder whose apartment granted it may always do
 * this; anybody else needs `meeting.manage`.
 */
export async function revokeProxy(
  ctx: BuildingContext,
  proxyId: string,
): Promise<Result<null>> {
  return withBuildingTx(ctx.building.id, async (tx) => {
    const proxy = await tx.proxy.findUnique({
      where: { id: proxyId },
      select: {
        id: true,
        meetingId: true,
        unitId: true,
        holderName: true,
        revokedAt: true,
        unit: { select: { label: true } },
      },
    });
    if (!proxy) return fail("not_found", "That proxy could not be found.");

    if (!ctx.unitIds.includes(proxy.unitId) && !can(ctx, "meeting.manage")) {
      return fail(
        "forbidden",
        "Only the apartment that granted this proxy, or an officer, can revoke it.",
      );
    }

    const gate = await openMeeting(tx, proxy.meetingId);
    if (!gate.ok) return gate.failure;

    if (proxy.revokedAt) return ok(null);

    await tx.proxy.update({
      where: { id: proxy.id },
      data: { revokedAt: new Date(), revokedById: ctx.membership.id },
    });

    // If the apartment was only present by proxy, it is no longer represented.
    await tx.meetingAttendance.deleteMany({
      where: { meetingId: proxy.meetingId, unitId: proxy.unitId, mode: "PROXY" },
    });

    await recordAudit(tx, ctx, {
      action: "meeting.revokeProxy",
      entityType: "MEETING",
      entityId: proxy.meetingId,
      before: { unit: proxy.unit.label, holderName: proxy.holderName },
      summary: `${proxy.unit.label} revoked the proxy held by ${proxy.holderName}`,
    });

    return ok(null);
  });
}

// --- Resolutions -----------------------------------------------------------

export interface ResolutionVoteInput {
  readonly unitId: string;
  readonly choice: VoteChoice;
  readonly byProxy?: boolean;
}

export interface RecordResolutionInput {
  readonly title: string;
  readonly text: string;
  readonly votes: readonly ResolutionVoteInput[];
  readonly thresholdNumerator?: number;
  readonly thresholdDenominator?: number;
  readonly thresholdStrict?: boolean;
  readonly basis?: "VOTED" | "PRESENT" | "OUTSTANDING";
}

export interface RecordResolutionResult {
  readonly resolutionId: string;
  readonly passed: boolean;
  readonly sharesFor: number;
  readonly sharesAgainst: number;
  readonly sharesAbstain: number;
}

/**
 * Records a resolution and how the building voted on it.
 *
 * The caller supplies apartments and choices — which is what a secretary
 * actually has — and the shares are looked up here, as of the meeting date, and
 * frozen onto each vote. Asking a secretary to type in share totals would be
 * asking them to do the one calculation this module exists to do.
 */
export async function recordResolution(
  ctx: BuildingContext,
  meetingId: string,
  input: RecordResolutionInput,
): Promise<Result<RecordResolutionResult>> {
  assertCan(ctx, "meeting.manage");

  const title = input.title.trim();
  if (title.length < 3) {
    return fail("invalid", "Give the resolution a name.", {
      title: "“Repoint the rear facade” is enough.",
    });
  }
  if (input.text.trim().length < 10) {
    return fail("invalid", "Write out what was resolved.", {
      text: "“Resolved, that the corporation…” — the words that were put to the room.",
    });
  }
  if (input.text.length > MAX_TEXT) {
    return fail("invalid", "That resolution is too long to store.", {
      text: "Keep it to the text of the motion; the detail belongs in the minutes.",
    });
  }
  if (input.votes.length === 0) {
    return fail("invalid", "Nobody voted, so there is nothing to record.", {
      votes: "Mark how each apartment voted.",
    });
  }

  const numerator = input.thresholdNumerator ?? 1;
  const denominator = input.thresholdDenominator ?? 2;
  const bad = checkFraction(numerator, denominator, "thresholdNumerator");
  if (bad) return bad;
  const strict = input.thresholdStrict ?? (numerator === 1 && denominator === 2);
  const basis = input.basis ?? "VOTED";

  const seen = new Set<string>();
  for (const vote of input.votes) {
    if (seen.has(vote.unitId)) {
      return fail("invalid", "An apartment cannot vote twice on one resolution.");
    }
    seen.add(vote.unitId);
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const gate = await openMeeting(tx, meetingId);
    if (!gate.ok) return gate.failure;

    const meeting = await tx.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      select: {
        quorumNumerator: true,
        quorumDenominator: true,
        quorumStrict: true,
      },
    });

    // The register as it stood on the day, not as it stands now.
    const asOf = toPlainDate(gate.meeting.scheduledFor);
    const register = await sharesAsOf(tx, asOf);
    const sharesByUnit = new Map(register.map((row) => [row.unitId, row.shares]));
    const labelByUnit = new Map(register.map((row) => [row.unitId, row.label]));

    const attendance = await tx.meetingAttendance.findMany({
      where: { meetingId },
      select: { unitId: true, mode: true },
    });
    const liveProxyUnits = new Set(
      (
        await tx.proxy.findMany({
          where: { meetingId, revokedAt: null },
          select: { unitId: true },
        })
      ).map((proxy) => proxy.unitId),
    );

    // Rule 1: no business without quorum.
    const quorum = computeQuorum({
      holdings: register.map((row) => ({ unitId: row.unitId, shares: row.shares })),
      presentUnitIds: attendance
        .filter((row) => row.mode !== "PROXY")
        .map((row) => row.unitId),
      proxyUnitIds: [
        ...liveProxyUnits,
        ...attendance.filter((row) => row.mode === "PROXY").map((row) => row.unitId),
      ],
      threshold: fractionThreshold(
        meeting.quorumNumerator,
        meeting.quorumDenominator,
        meeting.quorumStrict,
      ),
    });

    if (!quorum.met) {
      return fail(
        "conflict",
        `This meeting is ${quorum.shortBy.toLocaleString("en-US")} shares short of quorum, so no resolution can be recorded as carried at it. Record the rest of the attendance first.`,
      );
    }

    const represented = new Set(attendance.map((row) => row.unitId));

    let sharesFor = 0;
    let sharesAgainst = 0;
    let sharesAbstain = 0;

    for (const vote of input.votes) {
      const shares = sharesByUnit.get(vote.unitId);
      if (shares === undefined) {
        return fail("not_found", "One of those apartments could not be found.");
      }

      // Rule 2: only those present, in person or by proxy, may vote.
      if (!represented.has(vote.unitId)) {
        return fail(
          "conflict",
          `${labelByUnit.get(vote.unitId) ?? "An apartment"} is not recorded as present at this meeting, so its vote cannot be counted.`,
        );
      }
      if (vote.byProxy && !liveProxyUnits.has(vote.unitId)) {
        return fail(
          "conflict",
          `${labelByUnit.get(vote.unitId) ?? "An apartment"} has no live proxy for this meeting, so its vote cannot be recorded as cast by one.`,
        );
      }

      if (vote.choice === "FOR") sharesFor += shares;
      else if (vote.choice === "AGAINST") sharesAgainst += shares;
      else sharesAbstain += shares;
    }

    const outstanding = register.reduce((sum, row) => sum + row.shares, 0);
    const threshold = fractionThreshold(numerator, denominator, strict);
    const measured =
      basis === "VOTED"
        ? sharesFor + sharesAgainst
        : basis === "PRESENT"
          ? sharesFor + sharesAgainst + sharesAbstain
          : outstanding;

    // Cross-multiplied, so two-thirds is exactly two-thirds.
    const passed =
      measured > 0 &&
      (threshold.strict
        ? sharesFor * threshold.denominator > measured * threshold.numerator
        : sharesFor * threshold.denominator >= measured * threshold.numerator);

    const resolution = await tx.resolution.create({
      data: {
        buildingId: ctx.building.id,
        meetingId,
        title,
        text: input.text.trim(),
        sharesFor,
        sharesAgainst,
        sharesAbstain,
        passed,
        thresholdNumerator: numerator,
        thresholdDenominator: denominator,
        thresholdStrict: strict,
        basis,
        recordedAt: new Date(),
        recordedById: ctx.membership.id,
      },
      select: { id: true },
    });

    await tx.resolutionVote.createMany({
      data: input.votes.map((vote) => ({
        buildingId: ctx.building.id,
        resolutionId: resolution.id,
        unitId: vote.unitId,
        choice: vote.choice,
        shares: sharesByUnit.get(vote.unitId) ?? 0,
        byProxy: vote.byProxy ?? false,
      })),
    });

    await recordAudit(tx, ctx, {
      action: "meeting.recordResolution",
      entityType: "MEETING",
      entityId: meetingId,
      after: {
        resolutionId: resolution.id,
        title,
        sharesFor,
        sharesAgainst,
        sharesAbstain,
        threshold: `${numerator}/${denominator}`,
        basis,
        passed,
      },
      summary: `${title} ${passed ? "carried" : "failed"} on ${sharesFor.toLocaleString("en-US")} shares of ${measured.toLocaleString("en-US")}`,
    });

    return ok({
      resolutionId: resolution.id,
      passed,
      sharesFor,
      sharesAgainst,
      sharesAbstain,
    });
  });
}

// --- Minutes ---------------------------------------------------------------

export async function saveMinutes(
  ctx: BuildingContext,
  meetingId: string,
  minutes: string,
): Promise<Result<null>> {
  assertCan(ctx, "meeting.manage");

  if (minutes.length > MAX_TEXT) {
    return fail("invalid", "Those minutes are too long to store.", {
      minutes: "Attach the full text as a document and summarise here.",
    });
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const gate = await openMeeting(tx, meetingId);
    if (!gate.ok) return gate.failure;

    await tx.meeting.update({
      where: { id: meetingId },
      data: { minutes: minutes.trim() || null },
    });

    await recordAudit(tx, ctx, {
      action: "meeting.saveMinutes",
      entityType: "MEETING",
      entityId: meetingId,
      after: { characters: minutes.trim().length },
      summary: `Draft minutes saved for ${gate.meeting.title}`,
    });

    return ok(null);
  });
}

/**
 * Adopts the minutes, which closes the meeting's record.
 *
 * The point of adoption is that it is irreversible. A board that finds an error
 * afterwards corrects it at the next meeting, and that correction is itself
 * minuted — which is how a record survives the board that kept it. Letting an
 * officer quietly edit adopted minutes would remove the only reason anyone
 * trusts them.
 */
export async function adoptMinutes(
  ctx: BuildingContext,
  meetingId: string,
): Promise<Result<null>> {
  assertCan(ctx, "meeting.manage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const gate = await openMeeting(tx, meetingId);
    if (!gate.ok) return gate.failure;

    const meeting = await tx.meeting.findUniqueOrThrow({
      where: { id: meetingId },
      select: { minutes: true, heldAt: true, scheduledFor: true },
    });

    if (!meeting.minutes || meeting.minutes.trim().length < 20) {
      return fail(
        "invalid",
        "There are no minutes to adopt yet. Draft them first, then bring them to the board.",
        { minutes: "Write the minutes before adopting them." },
      );
    }

    await tx.meeting.update({
      where: { id: meetingId },
      data: {
        minutesAdoptedAt: new Date(),
        minutesAdoptedById: ctx.membership.id,
        // Adopting minutes for a meeting nobody marked as held is the common
        // case — it happened, the secretary just never ticked the box.
        heldAt: meeting.heldAt ?? meeting.scheduledFor,
      },
    });

    await recordAudit(tx, ctx, {
      action: "meeting.adoptMinutes",
      entityType: "MEETING",
      entityId: meetingId,
      after: { adoptedAt: new Date().toISOString() },
      summary: `Minutes adopted for ${gate.meeting.title}`,
    });

    return ok(null);
  });
}
