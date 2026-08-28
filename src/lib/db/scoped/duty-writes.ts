import type { DutyKind } from "~/generated/prisma/enums";
import { assertCan, can } from "~/lib/auth/capabilities";
import { turnsFrom } from "~/lib/primitives/duty";
import { reminderDates } from "~/lib/primitives/obligations/recurrence";
import { fail, ok, type Failure, type Result } from "~/lib/result";
import { compareDates, toDbDate, today, toPlainDate, type PlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx, type ScopedTx } from "../tx";
import { recordAudit } from "./audit";
import { asRotation, turnsCovering } from "./duty";

/**
 * Setting up the rotation, swapping turns, and logging what it cost when
 * nobody did.
 *
 * The mundane module, and the one most likely to produce a bill. Three things
 * here are worth more than the bookkeeping around them:
 *
 * 1. **Turns are materialised, not computed on demand.** A row per period, each
 *    with an obligation behind it, because a rotation nobody is reminded of is
 *    a rota on a fridge door. The formula generates them; after that the rows
 *    are the record.
 * 2. **A swap moves the turn and keeps both names.** `originalUnitId` holds who
 *    the rotation picked; `unitId` holds who actually has it. Overwriting one
 *    would make "3R's week, taken by 4F" unsayable three weeks later, which is
 *    exactly when it gets asked.
 * 3. **A fine is attributed from its date, not from memory.** A sanitation
 *    summons arrives weeks after the violation. The apartment is looked up from
 *    the turn the violation date fell in, and the officer logging it is shown
 *    the answer rather than asked for it — except for the one thing the date
 *    genuinely cannot settle, which is *which* rota a summons is about once a
 *    building runs bins and recycling on different weeks. That gets asked; see
 *    `attribute`.
 */

/** How far ahead of a turn to remind the apartment, in days. */
const TURN_REMINDER_OFFSETS = [2, 0];

/** How far ahead of a hearing date to start reminding. */
const HEARING_REMINDER_OFFSETS = [14, 3];

/** More than a year of turns at once is a rota nobody will keep looking at. */
const MAX_GENERATE = 120;

const MAX_CENTS = 100_000_000;

interface RotationRow {
  readonly id: string;
  readonly name: string;
  readonly kind: DutyKind;
  readonly unitOrder: string[];
  readonly startsOn: Date;
  readonly periodDays: number;
  readonly active: boolean;
}

async function findRotation(
  tx: ScopedTx,
  rotationId: string,
): Promise<{ ok: true; rotation: RotationRow } | { ok: false; failure: Failure }> {
  const rotation = await tx.dutyRotation.findUnique({
    where: { id: rotationId },
    select: {
      id: true,
      name: true,
      kind: true,
      unitOrder: true,
      startsOn: true,
      periodDays: true,
      active: true,
    },
  });

  if (!rotation) {
    return {
      ok: false,
      failure: fail("not_found", "That rotation could not be found."),
    };
  }
  return { ok: true, rotation };
}

// --- Setting it up ---------------------------------------------------------

export interface CreateRotationInput {
  readonly name: string;
  readonly kind?: DutyKind;
  readonly unitOrder: readonly string[];
  readonly startsOn: PlainDate;
  readonly periodDays?: number;
}

export async function createRotation(
  ctx: BuildingContext,
  input: CreateRotationInput,
): Promise<Result<{ rotationId: string }>> {
  assertCan(ctx, "duty.manage");

  const name = input.name.trim();
  if (name.length < 3) {
    return fail("invalid", "Give the rotation a name.", {
      name: "“Bins” or “Recycling” is enough.",
    });
  }

  const periodDays = input.periodDays ?? 7;
  if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 365) {
    return fail("invalid", "That period does not make sense.", {
      periodDays: "A turn lasts between a day and a year.",
    });
  }

  if (input.unitOrder.length === 0) {
    return fail("invalid", "Nobody is in the rotation.", {
      unitOrder: "Put the apartments in the order their turns come round.",
    });
  }
  if (new Set(input.unitOrder).size !== input.unitOrder.length) {
    return fail("invalid", "An apartment appears twice in the order.", {
      unitOrder: "Each apartment takes one turn per cycle.",
    });
  }

  return withBuildingTx(ctx.building.id, async (tx) => {
    // RLS means a unit from another building is simply absent, so counting is
    // enough to prove every id belongs here.
    const found = await tx.unit.count({ where: { id: { in: [...input.unitOrder] } } });
    if (found !== input.unitOrder.length) {
      return fail("not_found", "One of those apartments isn't in this building.");
    }

    const rotation = await tx.dutyRotation.create({
      data: {
        buildingId: ctx.building.id,
        name,
        kind: input.kind ?? "TRASH_SET_OUT",
        unitOrder: [...input.unitOrder],
        startsOn: toDbDate(input.startsOn),
        periodDays,
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "duty.createRotation",
      entityType: "BUILDING",
      entityId: rotation.id,
      after: { name, periodDays, apartments: input.unitOrder.length },
      summary: `${name} rotation set up, ${input.unitOrder.length} apartments every ${periodDays} days`,
    });

    return ok({ rotationId: rotation.id });
  });
}

export async function setRotationActive(
  ctx: BuildingContext,
  rotationId: string,
  active: boolean,
): Promise<Result<null>> {
  assertCan(ctx, "duty.manage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await findRotation(tx, rotationId);
    if (!found.ok) return found.failure;

    await tx.dutyRotation.update({ where: { id: rotationId }, data: { active } });

    await recordAudit(tx, ctx, {
      action: "duty.setRotationActive",
      entityType: "BUILDING",
      entityId: rotationId,
      after: { active },
      summary: `${found.rotation.name} rotation ${active ? "resumed" : "paused"}`,
    });

    return ok(null);
  });
}

// --- Generating the turns --------------------------------------------------

/**
 * Materialises the next `count` turns, each with a reminder behind it.
 *
 * Idempotent: a turn already on record is left exactly as it is, swaps
 * included. Running this again to extend the rota must never quietly undo
 * somebody's favour to their neighbour.
 */
export async function generateTurns(
  ctx: BuildingContext,
  rotationId: string,
  input: { count: number; from?: PlainDate } = { count: 12 },
): Promise<Result<{ created: number; through: PlainDate | null }>> {
  assertCan(ctx, "duty.manage");

  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_GENERATE) {
    return fail("invalid", "That is too many turns to generate at once.", {
      count: `Between 1 and ${MAX_GENERATE}.`,
    });
  }

  const now = today(ctx.building.timezone);

  return withBuildingTx(ctx.building.id, async (tx) => {
    const found = await findRotation(tx, rotationId);
    if (!found.ok) return found.failure;
    const { rotation } = found;

    if (!rotation.active) {
      return fail(
        "conflict",
        "That rotation is paused. Resume it before generating turns.",
      );
    }

    const existing = await tx.dutyAssignment.findMany({
      where: { rotationId },
      orderBy: { periodStart: "desc" },
      take: 1,
      select: { periodEnd: true },
    });

    // Carry on from where the rota stops, or from today if it is empty.
    const from = existing[0] ? toPlainDate(existing[0].periodEnd) : (input.from ?? now);

    const labels = new Map(
      (
        await tx.unit.findMany({
          where: { id: { in: rotation.unitOrder } },
          select: { id: true, label: true },
        })
      ).map((unit) => [unit.id, unit.label]),
    );

    let created = 0;
    let through: PlainDate | null = existing[0]
      ? toPlainDate(existing[0].periodEnd)
      : null;

    for (const turn of turnsFrom(asRotation(rotation), from, input.count + 1)) {
      // `turnsFrom` includes the turn `from` falls in, which is usually already
      // on record.
      const already = await tx.dutyAssignment.findUnique({
        where: {
          rotationId_periodStart: {
            rotationId,
            periodStart: toDbDate(turn.start),
          },
        },
        select: { id: true },
      });
      if (already) continue;
      if (created >= input.count) break;

      const obligation = await tx.obligation.create({
        data: {
          buildingId: ctx.building.id,
          kind: "DUTY",
          title: `${labels.get(turn.unitId) ?? "An apartment"} — ${rotation.name}`,
          detail: `${rotation.name} is ${labels.get(turn.unitId) ?? "this apartment"}'s from ${turn.start} to ${turn.end}.`,
          dueOn: toDbDate(turn.start),
          recurrenceType: "NONE",
          reminderOffsets: TURN_REMINDER_OFFSETS,
          subjectType: "DUTY_ASSIGNMENT",
          state: "OPEN",
        },
        select: { id: true },
      });

      const assignment = await tx.dutyAssignment.create({
        data: {
          buildingId: ctx.building.id,
          rotationId,
          unitId: turn.unitId,
          originalUnitId: turn.unitId,
          periodStart: toDbDate(turn.start),
          periodEnd: toDbDate(turn.end),
          obligationId: obligation.id,
        },
        select: { id: true },
      });

      // The obligation's subject is the assignment, which only exists once the
      // row is written.
      await tx.obligation.update({
        where: { id: obligation.id },
        data: { subjectId: assignment.id },
      });

      for (const reminder of reminderDates(turn.start, TURN_REMINDER_OFFSETS, now)) {
        await tx.obligationReminder.create({
          data: {
            buildingId: ctx.building.id,
            obligationId: obligation.id,
            offsetDays: reminder.offsetDays,
            scheduledFor: toDbDate(reminder.scheduledFor),
          },
        });
      }

      created += 1;
      through = turn.end;
    }

    if (created > 0) {
      await recordAudit(tx, ctx, {
        action: "duty.generateTurns",
        entityType: "BUILDING",
        entityId: rotationId,
        after: { created, through },
        summary: `${created} turns added to the ${rotation.name} rotation, through ${through}`,
      });
    }

    return ok({ created, through });
  });
}

// --- Swapping --------------------------------------------------------------

/**
 * Two apartments trade weeks.
 *
 * The most sociable feature in the product and the one most likely to be done
 * by text message instead. It is worth recording because a fine three weeks
 * later has to name whoever actually had the turn, and because a neighbour who
 * covered for someone should get the credit in the turn count.
 *
 * A shareholder may swap a turn that is theirs; an officer may arrange one
 * between any two apartments. Past turns cannot be swapped — the week has
 * happened, and rewriting it would move a fine onto someone who was away.
 */
export async function swapTurns(
  ctx: BuildingContext,
  input: { assignmentId: string; withAssignmentId: string },
): Promise<Result<null>> {
  assertCan(ctx, "duty.view");

  if (input.assignmentId === input.withAssignmentId) {
    return fail("invalid", "Those are the same turn.");
  }

  const now = today(ctx.building.timezone);

  return withBuildingTx(ctx.building.id, async (tx) => {
    const rows = await tx.dutyAssignment.findMany({
      where: { id: { in: [input.assignmentId, input.withAssignmentId] } },
      select: {
        id: true,
        rotationId: true,
        unitId: true,
        periodStart: true,
        periodEnd: true,
        obligationId: true,
        unit: { select: { label: true } },
      },
    });

    const a = rows.find((row) => row.id === input.assignmentId);
    const b = rows.find((row) => row.id === input.withAssignmentId);
    if (!a || !b) return fail("not_found", "One of those turns could not be found.");

    if (a.rotationId !== b.rotationId) {
      return fail("conflict", "Those turns are in different rotations.");
    }
    if (a.unitId === b.unitId) {
      return fail("invalid", "That apartment already has both turns.");
    }

    // Either turn being yours is enough — you are giving one away and taking
    // one back, so consent from the other side is a social matter rather than
    // something the software can verify.
    const mine = ctx.unitIds.includes(a.unitId) || ctx.unitIds.includes(b.unitId);
    if (!mine && !can(ctx, "duty.manage")) {
      return fail(
        "forbidden",
        "You can only swap a turn that belongs to your own apartment.",
      );
    }

    for (const row of [a, b]) {
      if (compareDates(toPlainDate(row.periodEnd), now) < 0) {
        return fail(
          "conflict",
          `${row.unit.label}'s turn ending ${toPlainDate(row.periodEnd)} has already passed, so it cannot be swapped.`,
        );
      }
    }

    const swappedAt = new Date();

    await tx.dutyAssignment.update({
      where: { id: a.id },
      data: {
        unitId: b.unitId,
        swappedWithId: b.id,
        swappedAt,
        swappedById: ctx.membership.id,
      },
    });
    await tx.dutyAssignment.update({
      where: { id: b.id },
      data: {
        unitId: a.unitId,
        swappedAt,
        swappedById: ctx.membership.id,
      },
    });

    // The reminders go to whoever has the turn now.
    for (const [row, label] of [
      [a, b.unit.label],
      [b, a.unit.label],
    ] as const) {
      if (!row.obligationId) continue;
      await tx.obligation.update({
        where: { id: row.obligationId },
        data: {
          title: `${label} — swapped`,
          detail: `Swapped with ${row.unit.label}. This turn runs ${toPlainDate(row.periodStart)} to ${toPlainDate(row.periodEnd)}.`,
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: "duty.swapTurns",
      entityType: "BUILDING",
      entityId: a.rotationId,
      before: { [a.unit.label]: toPlainDate(a.periodStart) },
      after: { [b.unit.label]: toPlainDate(a.periodStart) },
      summary: `${a.unit.label} and ${b.unit.label} swapped turns`,
    });

    return ok(null);
  });
}

// --- Fines -----------------------------------------------------------------

export interface LogFineInput {
  readonly ticketNumber: string;
  readonly issuedOn: PlainDate;
  readonly violation: string;
  readonly amountCents: number;
  /** The answer-by date printed on the summons, when it is to hand. */
  readonly hearingOn?: PlainDate | null;
  readonly note?: string | null;
  /** Overrides the apartment derived from the date. Rarely right. */
  readonly unitId?: string | null;
  /**
   * Which rota this summons is about. Three-valued on purpose:
   *
   *   omitted — work it out from the date, and refuse if more than one rota
   *             was running, because that is a question only the summons can
   *             answer;
   *   `null`  — this is not a rota's fault. Log it against the building.
   *   an id   — this rota, and derive the apartment from its turn.
   *
   * A building with one rotation never sees any of this: there is nothing to
   * disambiguate and the date is enough.
   */
  readonly rotationId?: string | null;
}

/**
 * Logs a sanitation summons, and works out whose week it was.
 *
 * The apartment is derived from the violation date rather than asked for. A
 * summons arrives two or three weeks after the fact, and by then the honest
 * answer to "whose week was that" is nobody's memory — it is the rota, which is
 * on record here.
 *
 * What the date alone cannot answer is *which* rota, once a building runs more
 * than one — bins on Tuesdays and recycling on Fridays are different weeks and
 * frequently different apartments. So the date settles whose turn it was within
 * a rota, and the summons settles which rota; where that is genuinely ambiguous
 * this refuses rather than picks, on the same principle that leaves a summons
 * the rota does not cover unattributed instead of pinned on somebody plausible.
 * The difference is that this one is answerable, so it asks.
 *
 * If the summons carries an answer-by date, it goes on the compliance calendar.
 * Missing that window is how a contestable fine becomes an unarguable one, and
 * it is the most expensive thing about this whole module.
 */
export async function logFine(
  ctx: BuildingContext,
  input: LogFineInput,
): Promise<Result<{ fineId: string; attributedUnitId: string | null }>> {
  assertCan(ctx, "duty.manage");

  const ticketNumber = input.ticketNumber.trim();
  if (ticketNumber.length < 3) {
    return fail("invalid", "The summons number is on the ticket.", {
      ticketNumber: "Copy it exactly — it is how the fine is looked up and contested.",
    });
  }

  const violation = input.violation.trim();
  if (violation.length < 3) {
    return fail("invalid", "What was the violation?", {
      violation: "As it is written on the summons.",
    });
  }

  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return fail("invalid", "An amount has to be more than nothing.", {
      amountCents: "Enter the amount on the summons, like 100.00",
    });
  }
  if (input.amountCents > MAX_CENTS) {
    return fail("invalid", "That amount looks like a typo.", {
      amountCents: "Check it against the summons.",
    });
  }

  if (input.hearingOn && compareDates(input.hearingOn, input.issuedOn) < 0) {
    return fail("invalid", "The hearing date is before the summons was issued.", {
      hearingOn: "Check the date on the summons.",
    });
  }

  const now = today(ctx.building.timezone);

  return withBuildingTx(ctx.building.id, async (tx) => {
    const duplicate = await tx.dsnyFine.findFirst({
      where: { ticketNumber },
      select: { id: true },
    });
    if (duplicate) {
      return fail("conflict", `Summons ${ticketNumber} is already on record.`);
    }

    // Whose week it was, from the rota rather than from anybody's memory.
    const attribution = await attribute(tx, input.issuedOn, input.rotationId);
    if (!attribution.ok) return attribution.failure;
    const turn = attribution.turn;

    const unitId = input.unitId ?? turn?.unitId ?? null;

    if (unitId) {
      const unit = await tx.unit.findUnique({
        where: { id: unitId },
        select: { id: true },
      });
      if (!unit) return fail("not_found", "That apartment isn't in this building.");
    }

    const fine = await tx.dsnyFine.create({
      data: {
        buildingId: ctx.building.id,
        unitId,
        dutyAssignmentId: turn?.id ?? null,
        ticketNumber,
        issuedOn: toDbDate(input.issuedOn),
        violation,
        amountCents: input.amountCents,
        hearingOn: input.hearingOn ? toDbDate(input.hearingOn) : null,
        note: input.note?.trim() || null,
        recordedById: ctx.membership.id,
      },
      select: { id: true },
    });

    if (input.hearingOn) {
      const obligation = await tx.obligation.create({
        data: {
          buildingId: ctx.building.id,
          kind: "DUTY",
          title: `Answer sanitation summons ${ticketNumber}`,
          detail: `${violation}. Answer or request a hearing by this date — a summons nobody answers is decided against the building by default. The date is the one printed on the summons, not one this system worked out.`,
          dueOn: toDbDate(input.hearingOn),
          recurrenceType: "NONE",
          reminderOffsets: HEARING_REMINDER_OFFSETS,
          subjectType: "BUILDING",
          subjectId: fine.id,
          state: "OPEN",
        },
        select: { id: true },
      });

      for (const reminder of reminderDates(
        input.hearingOn,
        HEARING_REMINDER_OFFSETS,
        now,
      )) {
        await tx.obligationReminder.create({
          data: {
            buildingId: ctx.building.id,
            obligationId: obligation.id,
            offsetDays: reminder.offsetDays,
            scheduledFor: toDbDate(reminder.scheduledFor),
          },
        });
      }

      await tx.dsnyFine.update({
        where: { id: fine.id },
        data: { obligationId: obligation.id },
      });
    }

    await recordAudit(tx, ctx, {
      action: "duty.logFine",
      entityType: "BUILDING",
      entityId: fine.id,
      after: {
        ticketNumber,
        issuedOn: input.issuedOn,
        amountCents: input.amountCents,
        attributedTo: unitId,
        derived: input.unitId == null,
      },
      summary: `Sanitation summons ${ticketNumber} logged for ${input.issuedOn}`,
    });

    return ok({ fineId: fine.id, attributedUnitId: unitId });
  });
}

/**
 * Which turn a summons belongs to, or a refusal to guess.
 *
 * Kept apart from `logFine` because the interesting case is one line of code
 * and several paragraphs of reasoning: when two rotas were running on the day,
 * there is no fact of the matter to derive. The date says whose turn it was in
 * each rota; only the summons says which rota it is about.
 *
 * Refusing is the right failure rather than the safe-looking one. Recording it
 * unattributed would be quieter, and it would also be a dead end — `updateFine`
 * deliberately cannot re-attribute a summons, so a fine logged against nobody
 * stays that way. The information exists, the person logging it is holding the
 * ticket, and a form is the right place to ask.
 */
type Attribution =
  | { ok: true; turn: { id: string; unitId: string } | null }
  | { ok: false; failure: Failure };

async function attribute(
  tx: ScopedTx,
  issuedOn: PlainDate,
  rotationId: string | null | undefined,
): Promise<Attribution> {
  // An explicit "this is not a rota's fault". The building pays it.
  if (rotationId === null) return { ok: true, turn: null };

  const covering = await turnsCovering(tx, issuedOn);

  if (rotationId !== undefined) {
    const named = covering.find((turn) => turn.rotationId === rotationId);
    if (named) return { ok: true, turn: named };

    // Naming a rota that was not running is a mistake worth reporting, not one
    // to absorb: the alternative is a summons quietly logged against nobody
    // under a rota the person believes it was attributed to.
    const rotation = await tx.dutyRotation.findUnique({
      where: { id: rotationId },
      select: { name: true },
    });
    if (!rotation) return { ok: false, failure: fail("not_found", "No such rota.") };

    return {
      ok: false,
      failure: fail(
        "invalid",
        `The ${rotation.name} rota has no turn covering ${issuedOn}. Generate its turns for that week, or log the summons against the building.`,
        { rotationId: "This rota was not running that day." },
      ),
    };
  }

  if (covering.length <= 1) return { ok: true, turn: covering[0] ?? null };

  const names = covering.map((turn) => turn.rotationName);
  return {
    ok: false,
    failure: fail(
      "invalid",
      `${names.join(" and ")} were both running on ${issuedOn}, and they were different apartments' weeks. Which rota is this summons about?`,
      { rotationId: "Pick the rota, or log it against the building." },
    ),
  };
}

export interface UpdateFineInput {
  readonly paidOn?: PlainDate | null;
  readonly contestedOn?: PlainDate | null;
  readonly outcome?: string | null;
  readonly note?: string | null;
}

export async function updateFine(
  ctx: BuildingContext,
  fineId: string,
  input: UpdateFineInput,
): Promise<Result<null>> {
  assertCan(ctx, "duty.manage");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const fine = await tx.dsnyFine.findUnique({
      where: { id: fineId },
      select: { id: true, ticketNumber: true, obligationId: true, issuedOn: true },
    });
    if (!fine) return fail("not_found", "That summons could not be found.");

    for (const [label, date] of [
      ["paidOn", input.paidOn],
      ["contestedOn", input.contestedOn],
    ] as const) {
      if (date && compareDates(date, toPlainDate(fine.issuedOn)) < 0) {
        return fail("invalid", "That is before the summons was issued.", {
          [label]: `The summons is dated ${toPlainDate(fine.issuedOn)}.`,
        });
      }
    }

    await tx.dsnyFine.update({
      where: { id: fineId },
      data: {
        ...(input.paidOn !== undefined
          ? { paidOn: input.paidOn ? toDbDate(input.paidOn) : null }
          : {}),
        ...(input.contestedOn !== undefined
          ? { contestedOn: input.contestedOn ? toDbDate(input.contestedOn) : null }
          : {}),
        ...(input.outcome !== undefined
          ? { outcome: input.outcome?.trim() || null }
          : {}),
        ...(input.note !== undefined ? { note: input.note?.trim() || null } : {}),
      },
    });

    // Answering it is the thing the calendar was nagging about.
    const answered = input.contestedOn ?? input.paidOn;
    if (answered && fine.obligationId) {
      await tx.obligation.update({
        where: { id: fine.obligationId },
        data: {
          state: "COMPLETED",
          completedOn: toDbDate(answered),
          completedById: ctx.membership.id,
          completionNote: input.contestedOn ? "Contested." : "Paid.",
        },
      });
    }

    await recordAudit(tx, ctx, {
      action: "duty.updateFine",
      entityType: "BUILDING",
      entityId: fineId,
      after: {
        paidOn: input.paidOn ?? null,
        contestedOn: input.contestedOn ?? null,
        outcome: input.outcome ?? null,
      },
      summary: `Summons ${fine.ticketNumber} ${input.contestedOn ? "contested" : input.paidOn ? "paid" : "updated"}`,
    });

    return ok(null);
  });
}

/**
 * Recharges a sanitation fine to the apartment whose turn it was.
 *
 * Refused unless the fine is attributed to an apartment, which in practice
 * means the rota covered that date — a building with no rotation on record has
 * nobody to bill and should absorb it rather than pick someone. Once only; a
 * correction is a reversing entry on the ledger.
 */
export async function chargeFineToUnit(
  ctx: BuildingContext,
  fineId: string,
  input: { dueOn: PlainDate; amountCents?: number; memo?: string | null },
): Promise<Result<{ chargeId: string }>> {
  assertCan(ctx, "arrears.postCharge");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const fine = await tx.dsnyFine.findUnique({
      where: { id: fineId },
      select: {
        id: true,
        unitId: true,
        ticketNumber: true,
        amountCents: true,
        dutyAssignmentId: true,
        unit: { select: { label: true } },
      },
    });
    if (!fine) return fail("not_found", "That summons could not be found.");

    if (!fine.unitId) {
      return fail(
        "conflict",
        "This summons isn't attributed to an apartment, so there is nobody to bill. The rota did not cover the day it was issued.",
      );
    }

    const amountCents = input.amountCents ?? fine.amountCents;
    if (!Number.isInteger(amountCents) || amountCents <= 0) {
      return fail("invalid", "An amount has to be more than nothing.", {
        amountCents: "Enter the amount to recharge.",
      });
    }
    if (amountCents > MAX_CENTS) {
      return fail("invalid", "That amount looks like a typo.", {
        amountCents: "Check it against the summons.",
      });
    }

    const existing = await tx.charge.findMany({
      where: { dsnyFineId: fineId },
      select: { id: true, reversesChargeId: true },
    });
    const reversed = new Set(
      existing.map((c) => c.reversesChargeId).filter((id): id is string => Boolean(id)),
    );
    const live = existing.filter((c) => !c.reversesChargeId && !reversed.has(c.id));
    if (live.length > 0) {
      return fail(
        "conflict",
        "This summons has already been recharged. Reverse that charge on the apartment's ledger if it was wrong.",
      );
    }

    const charge = await tx.charge.create({
      data: {
        buildingId: ctx.building.id,
        unitId: fine.unitId,
        kind: "OTHER",
        amountCents,
        dueOn: toDbDate(input.dueOn),
        postedOn: toDbDate(input.dueOn),
        memo: input.memo?.trim() || `Sanitation summons ${fine.ticketNumber}`,
        dsnyFineId: fine.id,
        createdById: ctx.membership.id,
      },
      select: { id: true },
    });

    await recordAudit(tx, ctx, {
      action: "duty.chargeFine",
      entityType: "BUILDING",
      entityId: fine.id,
      after: { chargeId: charge.id, amountCents, unit: fine.unit?.label },
      summary: `${fine.unit?.label ?? "An apartment"} recharged for summons ${fine.ticketNumber}`,
    });

    return ok({ chargeId: charge.id });
  });
}
