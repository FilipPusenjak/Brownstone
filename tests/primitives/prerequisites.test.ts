import { describe, expect, it } from "vitest";
import {
  evaluatePrerequisites,
  type Prerequisite,
  type PrerequisiteFacts,
} from "~/lib/primitives/prerequisites";
import { plainDate } from "~/lib/time";

const BOOKING_DATE = plainDate("2026-09-15");

function facts(overrides: Partial<PrerequisiteFacts> = {}): PrerequisiteFacts {
  return {
    depositPaidCents: 0,
    certificates: [],
    arrearsCents: 0,
    hasApprovedAlteration: false,
    bookingDate: BOOKING_DATE,
    ...overrides,
  };
}

const goodCoi = {
  id: "coi-1",
  holderName: "Vanguard Moving & Storage",
  coverageCents: 100_000_000,
  effectiveOn: plainDate("2026-01-01"),
  expiresOn: plainDate("2026-12-31"),
  additionalInsuredVerified: true,
};

/** The freight elevator: a deposit and a valid mover's certificate. */
const FREIGHT_ELEVATOR: Prerequisite[] = [
  { id: "p-deposit", type: "DEPOSIT_PAID", config: { amountCents: 50_000 } },
  {
    id: "p-coi",
    type: "VALID_COI",
    config: { minimumCoverageCents: 100_000_000, requireAdditionalInsured: true },
  },
];

describe("deposit", () => {
  it("passes once the deposit is recorded", () => {
    const result = evaluatePrerequisites(
      [FREIGHT_ELEVATOR[0] as Prerequisite],
      facts({ depositPaidCents: 50_000 }),
    );
    expect(result.satisfied).toBe(true);
  });

  it("says how much is still outstanding", () => {
    const result = evaluatePrerequisites(
      [FREIGHT_ELEVATOR[0] as Prerequisite],
      facts({ depositPaidCents: 20_000 }),
    );
    expect(result.satisfied).toBe(false);
    expect(result.outcomes[0]?.message).toContain("$300.00");
  });
});

describe("certificate of insurance", () => {
  const coiOnly = [FREIGHT_ELEVATOR[1] as Prerequisite];

  it("accepts a current certificate naming the corporation", () => {
    const result = evaluatePrerequisites(coiOnly, facts({ certificates: [goodCoi] }));
    expect(result.satisfied).toBe(true);
    expect(result.outcomes[0]?.evidenceId).toEqual("coi-1");
  });

  it("checks validity on the booking date, not today", () => {
    // A certificate that lapses the day before the move is the exact failure
    // this exists to catch. Checking against today would wave it through.
    const lapsing = { ...goodCoi, expiresOn: plainDate("2026-09-14") };
    const result = evaluatePrerequisites(coiOnly, facts({ certificates: [lapsing] }));

    expect(result.satisfied).toBe(false);
    expect(result.outcomes[0]?.message).toMatch(/before this booking/i);
  });

  it("rejects a certificate that has not taken effect yet", () => {
    const future = { ...goodCoi, effectiveOn: plainDate("2026-10-01") };
    const result = evaluatePrerequisites(coiOnly, facts({ certificates: [future] }));
    expect(result.satisfied).toBe(false);
  });

  it("accepts one valid on the booking date exactly", () => {
    const exact = {
      ...goodCoi,
      effectiveOn: BOOKING_DATE,
      expiresOn: BOOKING_DATE,
    };
    expect(evaluatePrerequisites(coiOnly, facts({ certificates: [exact] })).satisfied).toBe(
      true,
    );
  });

  it("rejects coverage below the building's minimum", () => {
    const thin = { ...goodCoi, coverageCents: 50_000_000 };
    const result = evaluatePrerequisites(coiOnly, facts({ certificates: [thin] }));

    expect(result.satisfied).toBe(false);
    expect(result.outcomes[0]?.message).toContain("$1,000,000.00");
  });

  it("rejects a certificate that does not name the corporation", () => {
    // The most common defect in a co-op COI: valid on its face, worthless to
    // the building.
    const notNamed = { ...goodCoi, additionalInsuredVerified: false };
    const result = evaluatePrerequisites(coiOnly, facts({ certificates: [notNamed] }));

    expect(result.satisfied).toBe(false);
    expect(result.outcomes[0]?.message).toMatch(/additional insured/i);
  });

  it("can be configured not to require the additional insured endorsement", () => {
    const relaxed: Prerequisite[] = [
      {
        id: "p-coi",
        type: "VALID_COI",
        config: { minimumCoverageCents: 100_000_000, requireAdditionalInsured: false },
      },
    ];
    const notNamed = { ...goodCoi, additionalInsuredVerified: false };
    expect(evaluatePrerequisites(relaxed, facts({ certificates: [notNamed] })).satisfied).toBe(
      true,
    );
  });

  it("picks the qualifying certificate when several are on file", () => {
    const thin = { ...goodCoi, id: "coi-thin", coverageCents: 1_000 };
    const result = evaluatePrerequisites(
      coiOnly,
      facts({ certificates: [thin, goodCoi] }),
    );
    expect(result.satisfied).toBe(true);
    expect(result.outcomes[0]?.evidenceId).toEqual("coi-1");
  });

  it("says plainly when nothing is on file", () => {
    const result = evaluatePrerequisites(coiOnly, facts());
    expect(result.outcomes[0]?.message).toMatch(/no certificate/i);
  });
});

describe("arrears", () => {
  const noArrears: Prerequisite[] = [{ id: "p", type: "NO_ARREARS", config: {} }];

  it("passes a unit that is up to date", () => {
    expect(evaluatePrerequisites(noArrears, facts()).satisfied).toBe(true);
  });

  it("passes a unit in credit", () => {
    expect(
      evaluatePrerequisites(noArrears, facts({ arrearsCents: -5_000 })).satisfied,
    ).toBe(true);
  });

  it("blocks a unit that owes money", () => {
    const result = evaluatePrerequisites(noArrears, facts({ arrearsCents: 90_000 }));
    expect(result.satisfied).toBe(false);
    expect(result.outcomes[0]?.message).toContain("$900.00");
  });

  it("honours a tolerance", () => {
    const lenient: Prerequisite[] = [
      { id: "p", type: "NO_ARREARS", config: { toleranceCents: 100_000 } },
    ];
    expect(
      evaluatePrerequisites(lenient, facts({ arrearsCents: 90_000 })).satisfied,
    ).toBe(true);
  });
});

describe("evaluatePrerequisites", () => {
  it("reports every failure at once", () => {
    // Telling someone about the deposit, then about the certificate after they
    // fix it, is two trips to the broker instead of one.
    const result = evaluatePrerequisites(FREIGHT_ELEVATOR, facts());

    expect(result.satisfied).toBe(false);
    expect(result.outcomes).toHaveLength(2);
    expect(result.outcomes.every((o) => !o.satisfied)).toBe(true);
  });

  it("passes only when everything passes", () => {
    const result = evaluatePrerequisites(
      FREIGHT_ELEVATOR,
      facts({ depositPaidCents: 50_000, certificates: [goodCoi] }),
    );
    expect(result.satisfied).toBe(true);
  });

  it("passes trivially when a resource requires nothing", () => {
    // The roof deck comes free: a resource with no prerequisite rows.
    expect(evaluatePrerequisites([], facts()).satisfied).toBe(true);
  });

  it("keeps each outcome tied to its prerequisite row", () => {
    const result = evaluatePrerequisites(FREIGHT_ELEVATOR, facts());
    expect(result.outcomes.map((o) => o.prerequisiteId)).toEqual(["p-deposit", "p-coi"]);
  });
});
