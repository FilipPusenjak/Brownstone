import type { WorkStatus } from "~/generated/prisma/enums";
import { assertCan } from "~/lib/auth/capabilities";
import { fail, ok, type Failure, type Result } from "~/lib/result";
import { toDbDate, type PlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { recordAudit } from "./audit";
import { postShareWeighted, type ShareWeightedLine } from "./ledger-writes";

/**
 * Recording building work, and raising the assessment that pays for it.
 *
 * The two halves are deliberately held apart, and by different capabilities.
 * Any officer may record that the roof needs doing and what the quote came to —
 * that is planning, and it costs nobody anything. Turning that estimate into
 * money owed by twelve neighbours takes `arrears.postCharge`, which is the
 * treasurer's alone.
 *
 * In a real co-op a special assessment follows a board vote, so the vote is
 * recorded here and the assessment will not be raised without one that carried.
 * Co-operator does not run the vote — nobody is casting a ballot in a browser —
 * it writes down what the board decided and then holds the money to it. Raising
 * remains a separate, deliberate act, attributed, and it cannot be done twice.
 */

const MAX_CENTS = 100_000_000;

function checkEstimate(cents: number): Failure | null {
  if (!Number.isInteger(cents) || cents <= 0) {
    return fail("invalid", "An estimate has to be more than nothing.", {
      estimate: "Enter an amount like 42,000.00",
    });
  }
  if (cents > MAX_CENTS) {
    return fail("invalid", "That estimate looks like a typo.", {
      estimate: "Amounts over $1,000,000 have to be recorded as separate work.",
    });
  }
  return null;
}

export interface CreateWorkInput {
  readonly title: string;
  readonly detail?: string | null;
  readonly estimateCents?: number | null;
  /** The compliance obligation this work satisfies, when it came from one. */
  readonly obligationId?: string | null;
}

export async function createWork(
  ctx: BuildingContext,
  input: CreateWorkInput,
): Promise<Result<{ workId: string }>> {
  assertCan(ctx, "work.manage");

  const title = input.title.trim();
  if (title.length < 3) {
    return fail("invalid", "Give the work a name.", {
      title: "“Replace the roof” is enough.",
    });
  }

  if (input.estimateCents != null) {
    const bad = checkEstimate(input.estimateCents);
    if (bad) return bad;
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    if (input.obligationId) {
      const obligation = await tx.obligation.findUnique({
        where: { id: input.obligationId },
        select: { id: true },
      });
      if (!obligation) {
        return fail("not_found", "That compliance item could not be found.");
      }
    }

    const work = await tx.buildingWork.create({
      data: {
        buildingId: ctx.building.id,
        title,
        detail: input.detail?.trim() || null,
        estimateCents: input.estimateCents ?? null,
        obligationId: input.obligationId ?? null,
        createdById: ctx.membership.id,
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "work.create",
      entityType: "BUILDING",
      entityId: work.id,
      after: { title, estimateCents: input.estimateCents ?? null },
      summary: `${title} added to the building's work`,
    });

    return ok({ workId: work.id });
  });
}

export interface UpdateWorkInput {
  readonly title?: string;
  readonly detail?: string | null;
  readonly estimateCents?: number | null;
  readonly status?: WorkStatus;
}

export async function updateWork(
  ctx: BuildingContext,
  workId: string,
  input: UpdateWorkInput,
): Promise<Result<null>> {
  assertCan(ctx, "work.manage");

  if (input.estimateCents != null) {
    const bad = checkEstimate(input.estimateCents);
    if (bad) return bad;
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const work = await tx.buildingWork.findUnique({
      where: { id: workId },
      select: {
        id: true,
        title: true,
        estimateCents: true,
        status: true,
        assessmentRaisedAt: true,
      },
    });
    if (!work) return fail("not_found", "That work could not be found.");

    // The estimate is what the assessment was justified by. Once money has been
    // raised against it, changing it would leave the charges unexplained.
    if (work.assessmentRaisedAt && input.estimateCents != null) {
      return fail(
        "conflict",
        "An assessment has already been raised for this work, so the estimate is now part of the record. Record a second piece of work if the cost has changed.",
      );
    }

    await tx.buildingWork.update({
      where: { id: work.id },
      data: {
        ...(input.title !== undefined ? { title: input.title.trim() } : {}),
        ...(input.detail !== undefined ? { detail: input.detail?.trim() || null } : {}),
        ...(input.estimateCents !== undefined
          ? { estimateCents: input.estimateCents }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
    });

    await recordAudit(tx, ctx, {
      action: "work.update",
      entityType: "BUILDING",
      entityId: work.id,
      before: { estimateCents: work.estimateCents, status: work.status },
      after: {
        estimateCents: input.estimateCents ?? work.estimateCents,
        status: input.status ?? work.status,
      },
      summary: `${work.title} updated`,
    });

    return ok(null);
  });
}

export interface RecordDecisionInput {
  readonly decidedOn: PlainDate;
  readonly votesFor: number;
  readonly votesAgainst: number;
  readonly votesAbstain?: number;
  readonly note?: string | null;
  /** Optional: the meeting it was decided at, when there was one. */
  readonly meetingId?: string | null;
}

/** Whether a recorded tally carried: a simple majority of the votes cast. */
export function decisionCarried(work: {
  decisionAt: Date | null;
  decisionFor: number | null;
  decisionAgainst: number | null;
}): boolean {
  if (!work.decisionAt) return false;
  return (work.decisionFor ?? 0) > (work.decisionAgainst ?? 0);
}

/**
 * Records the board's decision on a piece of work.
 *
 * Abstentions are stored but do not count toward the outcome: a simple majority
 * of the votes actually cast carries it, which is what "the board voted 4–1"
 * means to the people who were in the room.
 *
 * Recording a decision is not the same as raising money, so it stays with
 * `work.manage` — the secretary who keeps the minutes can write down what the
 * board decided without also being able to charge anyone for it.
 */
export async function recordDecision(
  ctx: BuildingContext,
  workId: string,
  input: RecordDecisionInput,
): Promise<Result<{ carried: boolean }>> {
  assertCan(ctx, "work.manage");

  const counts = [input.votesFor, input.votesAgainst, input.votesAbstain ?? 0];
  if (counts.some((n) => !Number.isInteger(n) || n < 0)) {
    return fail("invalid", "Vote counts have to be whole numbers.", {
      votesFor: "Enter how many voted each way.",
    });
  }
  if (input.votesFor + input.votesAgainst === 0) {
    return fail("invalid", "Nobody voted either way, so there is nothing to record.", {
      votesFor: "A decision needs at least one vote for or against.",
    });
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    const work = await tx.buildingWork.findUnique({
      where: { id: workId },
      select: { id: true, title: true, assessmentRaisedAt: true },
    });
    if (!work) return fail("not_found", "That work could not be found.");

    // The decision authorised the charges. Rewriting it afterwards would leave
    // real money explained by a vote that has since changed.
    if (work.assessmentRaisedAt) {
      return fail(
        "conflict",
        "An assessment has already been raised on the strength of this decision, so it is now part of the record.",
      );
    }

    if (input.meetingId) {
      const meeting = await tx.meeting.findUnique({
        where: { id: input.meetingId },
        select: { id: true },
      });
      if (!meeting) return fail("not_found", "That meeting could not be found.");
    }

    await tx.buildingWork.update({
      where: { id: work.id },
      data: {
        decisionAt: toDbDate(input.decidedOn),
        decisionFor: input.votesFor,
        decisionAgainst: input.votesAgainst,
        decisionAbstain: input.votesAbstain ?? 0,
        decisionNote: input.note?.trim() || null,
        decisionMeetingId: input.meetingId ?? null,
        decisionRecordedById: ctx.membership.id,
      },
    });

    const carried = input.votesFor > input.votesAgainst;

    await recordAudit(tx, ctx, {
      action: "work.recordDecision",
      entityType: "BUILDING",
      entityId: work.id,
      after: {
        decidedOn: input.decidedOn,
        for: input.votesFor,
        against: input.votesAgainst,
        abstain: input.votesAbstain ?? 0,
        carried,
      },
      summary: `Board voted ${input.votesFor}–${input.votesAgainst} on ${work.title}${carried ? "" : " (not carried)"}`,
    });

    return ok({ carried });
  });
}

export interface RaiseAssessmentInput {
  readonly dueOn: PlainDate;
  /** Defaults to the recorded estimate when omitted. */
  readonly totalCents?: number;
}

export interface RaiseAssessmentResult {
  readonly charged: number;
  readonly totalCents: number;
  readonly lines: readonly ShareWeightedLine[];
}

/**
 * Raises the assessment: the estimate becomes real money on every ledger.
 *
 * Share-weighted as of the due date, through the same code path as the monthly
 * maintenance run, and linked back to the work so the charges can always be
 * explained by pointing at what they paid for.
 *
 * Once. A second raise is refused rather than doubling everyone's assessment,
 * and correcting a mistake means reversing the charges — which leaves both the
 * error and the correction on the record, where a shareholder disputing their
 * bill can see them.
 */
export async function raiseAssessment(
  ctx: BuildingContext,
  workId: string,
  input: RaiseAssessmentInput,
): Promise<Result<RaiseAssessmentResult>> {
  // Recording work is any officer's job. Charging the building for it is not.
  assertCan(ctx, "arrears.postCharge");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const work = await tx.buildingWork.findUnique({
      where: { id: workId },
      select: {
        id: true,
        title: true,
        estimateCents: true,
        assessmentRaisedAt: true,
        decisionAt: true,
        decisionFor: true,
        decisionAgainst: true,
      },
    });
    if (!work) return fail("not_found", "That work could not be found.");

    if (work.assessmentRaisedAt) {
      return fail(
        "conflict",
        "An assessment has already been raised for this work. Reverse those charges if they were wrong.",
      );
    }

    // The vote comes first. This is the whole reason the decision is recorded
    // separately: an assessment nobody voted for is one the board cannot defend
    // at the next meeting, and the software should not be the reason it exists.
    if (!work.decisionAt) {
      return fail(
        "conflict",
        "Record the board's decision before raising the assessment. A special assessment needs a vote behind it.",
      );
    }
    if (!decisionCarried(work)) {
      return fail(
        "conflict",
        `The board voted this down ${work.decisionFor ?? 0}–${work.decisionAgainst ?? 0}. An assessment cannot be raised on a decision that did not carry.`,
      );
    }

    const totalCents = input.totalCents ?? work.estimateCents ?? 0;
    const bad = checkEstimate(totalCents);
    if (bad) {
      return totalCents <= 0 && input.totalCents == null
        ? fail(
            "invalid",
            "Record what the work is expected to cost before raising an assessment for it.",
          )
        : bad;
    }

    const posted = await postShareWeighted(tx, ctx, {
      kind: "ASSESSMENT",
      dueOn: input.dueOn,
      totalCents,
      memo: work.title,
      buildingWorkId: work.id,
    });
    if (!posted.ok) return posted;

    await tx.buildingWork.update({
      where: { id: work.id },
      data: {
        assessmentRaisedAt: new Date(),
        assessmentRaisedById: ctx.membership.id,
        assessmentTotalCents: totalCents,
        assessmentDueOn: toDbDate(input.dueOn),
        status: "APPROVED",
      },
    });

    await recordAudit(tx, ctx, {
      action: "work.raiseAssessment",
      entityType: "BUILDING",
      entityId: work.id,
      after: {
        totalCents,
        dueOn: input.dueOn,
        apartments: posted.data.length,
      },
      summary: `Assessment raised for ${work.title} across ${posted.data.length} apartments`,
    });

    return ok({
      charged: posted.data.length,
      totalCents,
      lines: posted.data,
    });
  });
}
