import type { PlainDate } from "~/lib/time";
import { compareDates } from "~/lib/time";

/**
 * Booking prerequisites, as a registry.
 *
 * The freight elevator needs a deposit and a valid mover's certificate of
 * insurance naming the corporation. Writing that as two conditions inside the
 * booking form would mean writing the roof deck's conditions again next year,
 * differently. So a prerequisite is a row, a checker is a function registered
 * against its type, and adding the roof deck is data.
 *
 * Checkers are pure: they take the facts and return a verdict. Fetching the
 * facts is the caller's job, which keeps this file testable without a database
 * and keeps the query in the scoped layer where it belongs.
 */

export type PrerequisiteType =
  "DEPOSIT_PAID" | "VALID_COI" | "NO_ARREARS" | "APPROVED_ALTERATION";

export interface PrerequisiteFacts {
  /** Deposits recorded against this booking, in cents. */
  readonly depositPaidCents: number;
  /** Certificates covering the booking window. */
  readonly certificates: ReadonlyArray<{
    readonly id: string;
    readonly holderName: string;
    readonly coverageCents: number | null;
    readonly expiresOn: PlainDate;
    readonly effectiveOn: PlainDate;
    readonly additionalInsuredVerified: boolean;
  }>;
  /** What the unit owes, in cents. Negative means in credit. */
  readonly arrearsCents: number;
  /** Whether an approved alteration covers this booking. */
  readonly hasApprovedAlteration: boolean;
  /** The day the booking starts — what a certificate must be valid for. */
  readonly bookingDate: PlainDate;
}

export interface PrerequisiteConfig {
  readonly amountCents?: number;
  readonly minimumCoverageCents?: number;
  readonly requireAdditionalInsured?: boolean;
  readonly toleranceCents?: number;
}

export interface CheckResult {
  readonly satisfied: boolean;
  /** Written for the person trying to book: what is wrong and what fixes it. */
  readonly message: string;
  /** The record that satisfied it, for the audit trail. */
  readonly evidenceId?: string;
}

export type Checker = (
  config: PrerequisiteConfig,
  facts: PrerequisiteFacts,
) => CheckResult;

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const CHECKERS: Record<PrerequisiteType, Checker> = {
  DEPOSIT_PAID(config, facts) {
    const required = config.amountCents ?? 0;
    if (facts.depositPaidCents >= required) {
      return {
        satisfied: true,
        message: `Deposit of ${formatCents(required)} recorded.`,
      };
    }
    const short = required - facts.depositPaidCents;
    return {
      satisfied: false,
      message: `Deposit outstanding. ${formatCents(short)} of the ${formatCents(required)} deposit has not been recorded yet.`,
    };
  },

  VALID_COI(config, facts) {
    // Valid *for the booking date*, not for today. A certificate that lapses
    // the day before the move is the exact failure this check exists to catch,
    // and checking against today would wave it through.
    const covering = facts.certificates.filter(
      (cert) =>
        compareDates(cert.effectiveOn, facts.bookingDate) <= 0 &&
        compareDates(cert.expiresOn, facts.bookingDate) >= 0,
    );

    if (covering.length === 0) {
      const lapsed = facts.certificates.find(
        (cert) => compareDates(cert.expiresOn, facts.bookingDate) < 0,
      );
      return {
        satisfied: false,
        message: lapsed
          ? `${lapsed.holderName}'s insurance expires ${lapsed.expiresOn}, before this booking. Ask them for a current certificate.`
          : "No certificate of insurance on file covering this date.",
      };
    }

    const minimum = config.minimumCoverageCents ?? 0;
    const enough = covering.filter((cert) => (cert.coverageCents ?? 0) >= minimum);
    if (enough.length === 0) {
      const best = covering[0];
      return {
        satisfied: false,
        message: `${best?.holderName ?? "The"} certificate covers ${formatCents(best?.coverageCents ?? 0)}, and this building requires ${formatCents(minimum)}.`,
      };
    }

    if (config.requireAdditionalInsured !== false) {
      const named = enough.find((cert) => cert.additionalInsuredVerified);
      if (!named) {
        // The most common defect in a co-op COI, and the one that makes an
        // otherwise valid certificate worthless to the building.
        return {
          satisfied: false,
          message: `${enough[0]?.holderName ?? "The"} certificate does not name the corporation as an additional insured. Ask the broker to reissue it.`,
        };
      }
      return {
        satisfied: true,
        message: `${named.holderName} insured to ${formatCents(named.coverageCents ?? 0)}, corporation named.`,
        evidenceId: named.id,
      };
    }

    const first = enough[0];
    return {
      satisfied: true,
      message: `${first?.holderName ?? "Certificate"} on file and current.`,
      ...(first ? { evidenceId: first.id } : {}),
    };
  },

  NO_ARREARS(config, facts) {
    const tolerance = config.toleranceCents ?? 0;
    if (facts.arrearsCents <= tolerance) {
      return { satisfied: true, message: "Maintenance is up to date." };
    }
    return {
      satisfied: false,
      message: `${formatCents(facts.arrearsCents)} of maintenance is outstanding on this unit.`,
    };
  },

  APPROVED_ALTERATION(_config, facts) {
    return facts.hasApprovedAlteration
      ? { satisfied: true, message: "Alteration approved." }
      : {
          satisfied: false,
          message:
            "No approved alteration covers this work. File an alteration request before booking.",
        };
  },
};

export interface Prerequisite {
  readonly id: string;
  readonly type: PrerequisiteType;
  readonly config: PrerequisiteConfig;
}

export interface PrerequisiteOutcome extends CheckResult {
  readonly prerequisiteId: string;
  readonly type: PrerequisiteType;
}

/**
 * Evaluates every prerequisite. Returns all outcomes rather than short-circuiting
 * — someone who is missing a deposit *and* a certificate should be told both at
 * once instead of discovering the second after fixing the first.
 */
export function evaluatePrerequisites(
  prerequisites: readonly Prerequisite[],
  facts: PrerequisiteFacts,
): { readonly satisfied: boolean; readonly outcomes: PrerequisiteOutcome[] } {
  const outcomes = prerequisites.map((prerequisite) => {
    const checker = CHECKERS[prerequisite.type];
    const result = checker(prerequisite.config, facts);
    return { ...result, prerequisiteId: prerequisite.id, type: prerequisite.type };
  });

  return { satisfied: outcomes.every((o) => o.satisfied), outcomes };
}

/** Exposed for tests and for a future admin screen listing what can be required. */
export const PREREQUISITE_TYPES = Object.keys(CHECKERS) as PrerequisiteType[];
