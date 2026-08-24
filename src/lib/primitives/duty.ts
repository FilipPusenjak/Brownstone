import { addDays, compareDates, daysBetween, type PlainDate } from "~/lib/time";

/**
 * Whose turn it is, and — the question that actually gets asked — whose turn it
 * *was*.
 *
 * A sanitation summons arrives three weeks after the violation. By then nobody
 * remembers who had that week, and the honest answer matters: it decides
 * whether the corporation absorbs the fine or a shareholder does. Working it
 * back from a rotation, a start date and a period length is the sort of
 * arithmetic that gets done wrong on a kitchen table and right here.
 *
 * Two things this deliberately does not do. It does not know about swaps —
 * those are recorded assignments, and the caller must prefer a recorded turn to
 * a computed one, because a neighbour who took someone's week is the person who
 * actually had it. And it never wraps a date before the rotation began into the
 * last position; a rotation that started in March has no answer for February.
 */

export interface Rotation {
  /** Unit ids in order. Order is the whole point. */
  readonly unitOrder: readonly string[];
  readonly startsOn: PlainDate;
  readonly periodDays: number;
}

export interface Period {
  readonly index: number;
  readonly start: PlainDate;
  readonly end: PlainDate;
  readonly unitId: string;
}

/**
 * Which period a date falls in, counting from zero.
 *
 * Null before the rotation begins. Floor division on whole days, so a
 * seven-day period starting Monday puts the following Monday in period 1 rather
 * than leaving it ambiguously in period 0 — the off-by-one that would blame the
 * wrong neighbour every time a fine lands on a changeover day.
 */
export function periodIndexOn(rotation: Rotation, date: PlainDate): number | null {
  if (rotation.periodDays <= 0) return null;
  const elapsed = daysBetween(rotation.startsOn, date);
  if (elapsed < 0) return null;
  return Math.floor(elapsed / rotation.periodDays);
}

/** The dates one period covers, inclusive at both ends. */
export function periodBounds(
  rotation: Rotation,
  index: number,
): { start: PlainDate; end: PlainDate } {
  const start = addDays(rotation.startsOn, index * rotation.periodDays);
  return { start, end: addDays(start, rotation.periodDays - 1) };
}

/**
 * The unit the rotation says has this period.
 *
 * The formula's answer, which is not always the truth — see the note about
 * swaps above.
 */
export function unitForPeriod(rotation: Rotation, index: number): string | null {
  if (rotation.unitOrder.length === 0) return null;
  const position = index % rotation.unitOrder.length;
  return rotation.unitOrder[position] ?? null;
}

/** The turn covering a date, or null if the rotation had not started. */
export function turnOn(rotation: Rotation, date: PlainDate): Period | null {
  const index = periodIndexOn(rotation, date);
  if (index === null) return null;

  const unitId = unitForPeriod(rotation, index);
  if (!unitId) return null;

  const { start, end } = periodBounds(rotation, index);
  return { index, start, end, unitId };
}

/**
 * The next `count` turns from a date, including the one it falls in.
 *
 * Used to materialise assignments ahead of time so each turn can carry a
 * reminder. A rotation nobody is reminded of is a rota on a fridge door.
 */
export function turnsFrom(
  rotation: Rotation,
  from: PlainDate,
  count: number,
): Period[] {
  if (count <= 0 || rotation.unitOrder.length === 0) return [];

  // A rotation that has not started yet begins at its first period rather than
  // skipping the run-up.
  const first =
    compareDates(from, rotation.startsOn) < 0
      ? 0
      : (periodIndexOn(rotation, from) ?? 0);

  return Array.from({ length: count }, (_, offset) => {
    const index = first + offset;
    const { start, end } = periodBounds(rotation, index);
    return { index, start, end, unitId: unitForPeriod(rotation, index)! };
  });
}

/**
 * How many turns each apartment has had over a span of periods.
 *
 * A rotation whose length does not divide the number of periods gives some
 * apartments one more turn than others, which is fair over time and looks
 * unfair in any given quarter. Showing the count is how that argument gets
 * settled without anybody counting on their fingers.
 */
export function turnsEach(
  rotation: Rotation,
  fromIndex: number,
  toIndex: number,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const unitId of rotation.unitOrder) counts.set(unitId, 0);

  for (let index = fromIndex; index <= toIndex; index += 1) {
    const unitId = unitForPeriod(rotation, index);
    if (unitId) counts.set(unitId, (counts.get(unitId) ?? 0) + 1);
  }
  return counts;
}
