import type { Money } from "~/lib/money";
import { add, money, ZERO } from "~/lib/money";
import type { PlainDate } from "~/lib/time";
import { compareDates, daysBetween } from "~/lib/time";

/**
 * Ledger arithmetic: balances and aging.
 *
 * The ledger is append-only. A correction is a reversing entry that points at
 * what it reverses, and both the original and the reversal stay on the record —
 * which means every function here has to handle reversal pairs rather than
 * assuming each row is live.
 *
 * All integer cents. A maintenance ledger is the last place to discover that
 * 0.1 + 0.2 is not 0.3.
 */

export interface LedgerCharge {
  readonly id: string;
  readonly unitId: string;
  readonly amountCents: number;
  readonly dueOn: PlainDate;
  readonly reversesChargeId?: string | null;
  readonly kind?: string;
}

export interface LedgerPayment {
  readonly id: string;
  readonly unitId: string;
  readonly amountCents: number;
  readonly receivedOn: PlainDate;
  readonly reversesPaymentId?: string | null;
}

/**
 * Drops reversal pairs: a reversing entry and the entry it reverses both leave
 * the running total, and both stay in the record.
 */
function live<T extends { id: string }>(
  entries: readonly T[],
  reversalKey: (entry: T) => string | null | undefined,
): T[] {
  const reversed = new Set<string>();
  const reversals = new Set<string>();

  for (const entry of entries) {
    const target = reversalKey(entry);
    if (target) {
      reversed.add(target);
      reversals.add(entry.id);
    }
  }

  return entries.filter((entry) => !reversed.has(entry.id) && !reversals.has(entry.id));
}

export function liveCharges(charges: readonly LedgerCharge[]): LedgerCharge[] {
  return live(charges, (c) => c.reversesChargeId);
}

export function livePayments(payments: readonly LedgerPayment[]): LedgerPayment[] {
  return live(payments, (p) => p.reversesPaymentId);
}

/** Charged minus paid. Positive means the unit owes the building. */
export function balance(
  charges: readonly LedgerCharge[],
  payments: readonly LedgerPayment[],
): Money {
  const charged = liveCharges(charges).reduce<number>((sum, c) => sum + c.amountCents, 0);
  const paid = livePayments(payments).reduce<number>((sum, p) => sum + p.amountCents, 0);
  return money(charged - paid);
}

export interface AgingBuckets {
  readonly current: Money;
  readonly days30: Money;
  readonly days60: Money;
  readonly days90: Money;
  readonly over90: Money;
  readonly total: Money;
  /** Days since the oldest unpaid charge fell due. 0 when nothing is owed. */
  readonly oldestDaysOverdue: number;
}

const EMPTY: AgingBuckets = {
  current: ZERO,
  days30: ZERO,
  days60: ZERO,
  days90: ZERO,
  over90: ZERO,
  total: ZERO,
  oldestDaysOverdue: 0,
};

/**
 * Aging for one unit, as of a date.
 *
 * Payments are applied oldest charge first. That convention matters and is not
 * arbitrary: applying to the newest charge instead would keep a unit
 * permanently in the 90-day bucket while they pay every month, which is both
 * wrong and the sort of thing that starts an argument at a board meeting.
 *
 * A credit balance — someone paid ahead — returns all-zero buckets rather than
 * negative ones. Nothing is overdue when the building is holding your money.
 */
export function agingFor(
  charges: readonly LedgerCharge[],
  payments: readonly LedgerPayment[],
  asOf: PlainDate,
): AgingBuckets {
  const open = liveCharges(charges)
    .filter((charge) => compareDates(charge.dueOn, asOf) <= 0)
    .sort((a, b) => compareDates(a.dueOn, b.dueOn) || a.id.localeCompare(b.id));

  let credit = livePayments(payments)
    .filter((payment) => compareDates(payment.receivedOn, asOf) <= 0)
    .reduce<number>((sum, payment) => sum + payment.amountCents, 0);

  const buckets = { current: 0, days30: 0, days60: 0, days90: 0, over90: 0 };
  let oldestDaysOverdue = 0;

  for (const charge of open) {
    const applied = Math.min(credit, charge.amountCents);
    credit -= applied;

    const outstanding = charge.amountCents - applied;
    if (outstanding <= 0) continue;

    const age = daysBetween(charge.dueOn, asOf);
    oldestDaysOverdue = Math.max(oldestDaysOverdue, age);

    if (age <= 0) buckets.current += outstanding;
    else if (age <= 30) buckets.days30 += outstanding;
    else if (age <= 60) buckets.days60 += outstanding;
    else if (age <= 90) buckets.days90 += outstanding;
    else buckets.over90 += outstanding;
  }

  const total =
    buckets.current + buckets.days30 + buckets.days60 + buckets.days90 + buckets.over90;

  if (total === 0) return EMPTY;

  return {
    current: money(buckets.current),
    days30: money(buckets.days30),
    days60: money(buckets.days60),
    days90: money(buckets.days90),
    over90: money(buckets.over90),
    total: money(total),
    oldestDaysOverdue,
  };
}

export interface UnitAging extends AgingBuckets {
  readonly unitId: string;
}

/** The arrears report: aging per unit, worst first. */
export function agingByUnit(
  charges: readonly LedgerCharge[],
  payments: readonly LedgerPayment[],
  asOf: PlainDate,
): UnitAging[] {
  const unitIds = new Set([
    ...charges.map((c) => c.unitId),
    ...payments.map((p) => p.unitId),
  ]);

  return [...unitIds]
    .map((unitId) => ({
      unitId,
      ...agingFor(
        charges.filter((c) => c.unitId === unitId),
        payments.filter((p) => p.unitId === unitId),
        asOf,
      ),
    }))
    .sort((a, b) => b.total - a.total || b.oldestDaysOverdue - a.oldestDaysOverdue);
}

/** Building-wide totals for the arrears summary. */
export function agingTotals(rows: readonly UnitAging[]): AgingBuckets {
  if (rows.length === 0) return EMPTY;

  return {
    current: add(...rows.map((r) => r.current)),
    days30: add(...rows.map((r) => r.days30)),
    days60: add(...rows.map((r) => r.days60)),
    days90: add(...rows.map((r) => r.days90)),
    over90: add(...rows.map((r) => r.over90)),
    total: add(...rows.map((r) => r.total)),
    oldestDaysOverdue: Math.max(...rows.map((r) => r.oldestDaysOverdue), 0),
  };
}

/**
 * Builds the reversing entry for a charge. The original is never touched.
 */
export function reversalOf(charge: LedgerCharge, postedOn: PlainDate) {
  return {
    unitId: charge.unitId,
    amountCents: -charge.amountCents,
    dueOn: charge.dueOn,
    postedOn,
    reversesChargeId: charge.id,
  };
}
