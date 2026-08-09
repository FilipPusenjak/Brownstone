import { describe, expect, it } from "vitest";
import {
  agingByUnit,
  agingFor,
  agingTotals,
  balance,
  liveCharges,
  reversalOf,
  type LedgerCharge,
  type LedgerPayment,
} from "~/lib/primitives/ledger";
import { plainDate, type PlainDate } from "~/lib/time";

const d = (value: string): PlainDate => plainDate(value);
const TODAY = d("2026-06-15");

function charge(
  id: string,
  dueOn: string,
  amountCents: number,
  extra: Partial<LedgerCharge> = {},
): LedgerCharge {
  return { id, unitId: "3r", amountCents, dueOn: d(dueOn), ...extra };
}

function payment(
  id: string,
  receivedOn: string,
  amountCents: number,
  extra: Partial<LedgerPayment> = {},
): LedgerPayment {
  return { id, unitId: "3r", amountCents, receivedOn: d(receivedOn), ...extra };
}

describe("balance", () => {
  it("is charges minus payments", () => {
    expect(
      balance([charge("c1", "2026-05-01", 90_000)], [payment("p1", "2026-05-03", 30_000)]),
    ).toEqual(60_000);
  });

  it("is zero when settled", () => {
    expect(
      balance([charge("c1", "2026-05-01", 90_000)], [payment("p1", "2026-05-03", 90_000)]),
    ).toEqual(0);
  });

  it("goes negative when a unit pays ahead", () => {
    expect(balance([], [payment("p1", "2026-05-03", 5_000)])).toEqual(-5_000);
  });
});

describe("reversals", () => {
  it("removes both the original and its reversal from the running total", () => {
    const charges = [
      charge("c1", "2026-05-01", 90_000),
      charge("c2", "2026-05-01", 5_000),
      charge("c3", "2026-05-02", -5_000, { reversesChargeId: "c2" }),
    ];

    // The mistaken charge and the entry correcting it both stay on the record
    // and neither counts toward what is owed.
    expect(liveCharges(charges).map((c) => c.id)).toEqual(["c1"]);
    expect(balance(charges, [])).toEqual(90_000);
  });

  it("builds a reversing entry without touching the original", () => {
    const original = charge("c1", "2026-05-01", 90_000);
    const reversal = reversalOf(original, d("2026-06-01"));

    expect(reversal.amountCents).toEqual(-90_000);
    expect(reversal.reversesChargeId).toEqual("c1");
    expect(reversal.dueOn).toEqual(original.dueOn);
    expect(original.amountCents).toEqual(90_000);
  });

  it("reverses payments too", () => {
    const payments = [
      payment("p1", "2026-05-01", 90_000),
      payment("p2", "2026-05-09", -90_000, { reversesPaymentId: "p1" }),
    ];
    // A bounced cheque: the payment and its reversal both stay, and the unit
    // owes the money again.
    expect(balance([charge("c1", "2026-05-01", 90_000)], payments)).toEqual(90_000);
  });
});

describe("agingFor", () => {
  it("puts a charge not yet due in current", () => {
    const result = agingFor([charge("c1", "2026-06-15", 90_000)], [], TODAY);
    expect(result.current).toEqual(90_000);
    expect(result.total).toEqual(90_000);
    expect(result.oldestDaysOverdue).toEqual(0);
  });

  it("ignores charges due after the as-of date", () => {
    const result = agingFor([charge("c1", "2026-07-01", 90_000)], [], TODAY);
    expect(result.total).toEqual(0);
  });

  it("sorts charges into the right buckets by age", () => {
    const result = agingFor(
      [
        charge("c1", "2026-06-10", 10_000), //   5 days
        charge("c2", "2026-05-10", 20_000), //  36 days
        charge("c3", "2026-04-10", 30_000), //  66 days
        charge("c4", "2026-02-10", 40_000), // 125 days
      ],
      [],
      TODAY,
    );

    expect(result.days30).toEqual(10_000);
    expect(result.days60).toEqual(20_000);
    expect(result.days90).toEqual(30_000);
    expect(result.over90).toEqual(40_000);
    expect(result.total).toEqual(100_000);
    expect(result.oldestDaysOverdue).toEqual(125);
  });

  it("is exact on bucket boundaries", () => {
    const at30 = agingFor([charge("c1", "2026-05-16", 1_000)], [], TODAY);
    const at31 = agingFor([charge("c1", "2026-05-15", 1_000)], [], TODAY);
    expect(at30.days30).toEqual(1_000);
    expect(at31.days60).toEqual(1_000);
  });

  it("applies payments to the oldest charge first", () => {
    // The alternative — applying to the newest — keeps a unit permanently in
    // the 90-day bucket while they pay every month, which is both wrong and
    // the sort of thing that starts an argument at a board meeting.
    const result = agingFor(
      [
        charge("c1", "2026-02-10", 90_000), // 125 days
        charge("c2", "2026-06-10", 90_000), //   5 days
      ],
      [payment("p1", "2026-06-11", 90_000)],
      TODAY,
    );

    expect(result.over90).toEqual(0);
    expect(result.days30).toEqual(90_000);
    expect(result.oldestDaysOverdue).toEqual(5);
  });

  it("handles a payment that partly covers the oldest charge", () => {
    const result = agingFor(
      [charge("c1", "2026-02-10", 90_000), charge("c2", "2026-06-10", 90_000)],
      [payment("p1", "2026-06-11", 40_000)],
      TODAY,
    );

    expect(result.over90).toEqual(50_000);
    expect(result.days30).toEqual(90_000);
    expect(result.total).toEqual(140_000);
  });

  it("reports nothing owed when a unit is in credit", () => {
    // Nothing is overdue when the building is holding your money. Negative
    // buckets would show up as a red flag on the elevation for a unit that
    // paid early.
    const result = agingFor(
      [charge("c1", "2026-02-10", 90_000)],
      [payment("p1", "2026-02-01", 120_000)],
      TODAY,
    );

    expect(result.total).toEqual(0);
    expect(result.over90).toEqual(0);
    expect(result.oldestDaysOverdue).toEqual(0);
  });

  it("ignores payments received after the as-of date", () => {
    const result = agingFor(
      [charge("c1", "2026-05-01", 90_000)],
      [payment("p1", "2026-06-20", 90_000)],
      TODAY,
    );
    expect(result.total).toEqual(90_000);
  });

  it("excludes reversed charges from aging", () => {
    const result = agingFor(
      [
        charge("c1", "2026-02-10", 90_000),
        charge("c2", "2026-02-11", -90_000, { reversesChargeId: "c1" }),
      ],
      [],
      TODAY,
    );
    expect(result.total).toEqual(0);
  });

  it("buckets always sum to the total", () => {
    const result = agingFor(
      [
        charge("c1", "2026-06-14", 1_111),
        charge("c2", "2026-05-01", 2_222),
        charge("c3", "2026-03-01", 3_333),
        charge("c4", "2026-01-01", 4_444),
      ],
      [payment("p1", "2026-06-01", 1_000)],
      TODAY,
    );

    const sum =
      result.current + result.days30 + result.days60 + result.days90 + result.over90;
    expect(sum).toEqual(result.total);
  });
});

describe("agingByUnit", () => {
  const charges: LedgerCharge[] = [
    { id: "a1", unitId: "3r", amountCents: 90_000, dueOn: d("2026-03-01") },
    { id: "a2", unitId: "2f", amountCents: 90_000, dueOn: d("2026-06-01") },
    { id: "a3", unitId: "1f", amountCents: 90_000, dueOn: d("2026-06-01") },
  ];
  const payments: LedgerPayment[] = [
    { id: "b1", unitId: "1f", amountCents: 90_000, receivedOn: d("2026-06-02") },
  ];

  it("reports each unit separately, worst first", () => {
    const rows = agingByUnit(charges, payments, TODAY);
    expect(rows[0]?.unitId).toEqual("3r");
    expect(rows[0]?.over90).toEqual(90_000);
  });

  it("includes units that owe nothing, with zero totals", () => {
    const rows = agingByUnit(charges, payments, TODAY);
    const paidUp = rows.find((row) => row.unitId === "1f");
    expect(paidUp?.total).toEqual(0);
  });

  it("never mixes one unit's payments into another's aging", () => {
    const rows = agingByUnit(charges, payments, TODAY);
    expect(rows.find((row) => row.unitId === "2f")?.total).toEqual(90_000);
  });

  it("totals across the building", () => {
    const totals = agingTotals(agingByUnit(charges, payments, TODAY));
    expect(totals.total).toEqual(180_000);
    expect(totals.oldestDaysOverdue).toEqual(106);
  });

  it("totals an empty building to zero", () => {
    expect(agingTotals([]).total).toEqual(0);
  });
});
