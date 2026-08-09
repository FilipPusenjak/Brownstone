/**
 * Share-weighted arithmetic.
 *
 * In a co-op, votes and maintenance are weighted by shares, never by unit. A
 * building where four of twelve units hold sixty per cent of the shares is
 * normal, and counting heads there produces a quorum that does not exist and a
 * resolution that did not pass.
 *
 * Thresholds are exact fractions, compared by cross-multiplication, so no
 * division or rounding happens anywhere between the bylaws and the result. A
 * vote landing exactly on the line is precisely the vote someone will contest.
 */

export interface ShareHolding {
  readonly unitId: string;
  readonly shares: number;
}

/**
 * A voting threshold, as an exact fraction.
 *
 * Bylaws are written in fractions — "a majority", "two-thirds", "three
 * quarters" — and two-thirds has no exact representation in basis points.
 * Rounding it to 6667 requires 801 of 1200 shares where two-thirds is exactly
 * 800, so a resolution carried by precisely two-thirds fails by one share, on
 * the very vote most likely to be contested. Rounding down to 6666 has the
 * mirror problem.
 *
 * `strict` separates "more than half" from "at least half". A majority is
 * strict; a two-thirds requirement usually is not. Getting that wrong flips
 * every tied vote.
 */
export interface Threshold {
  readonly numerator: number;
  readonly denominator: number;
  readonly strict: boolean;
  readonly label: string;
}

export const MAJORITY: Threshold = {
  numerator: 1,
  denominator: 2,
  strict: true,
  label: "a majority",
};

export const TWO_THIRDS: Threshold = {
  numerator: 2,
  denominator: 3,
  strict: false,
  label: "two-thirds",
};

export const THREE_QUARTERS: Threshold = {
  numerator: 3,
  denominator: 4,
  strict: false,
  label: "three-quarters",
};

/** For a building whose bylaws name a percentage rather than a fraction. */
export function percentThreshold(percent: number, strict = false): Threshold {
  return {
    numerator: Math.round(percent * 100),
    denominator: 10_000,
    strict,
    label: `${percent}%`,
  };
}

/** One hundredth of a percent. Used for *display* of a computed weight only. */
export type BasisPoints = number;

export function totalShares(holdings: readonly ShareHolding[]): number {
  return holdings.reduce((sum, holding) => sum + holding.shares, 0);
}

/**
 * A unit's weight, in basis points of the whole building.
 *
 * Rounded for display only. Never feed the result back into a threshold test —
 * use `meetsThreshold`, which compares before any rounding happens.
 */
export function weightOf(shares: number, total: number): BasisPoints {
  if (total <= 0) return 0;
  return Math.round((shares * 10_000) / total);
}

/**
 * Whether `shares` out of `total` reaches `threshold`.
 *
 * Cross-multiplied, so nothing is divided and nothing is rounded anywhere in
 * the comparison. With floats, two-thirds of 1200 is 800.0000000000001 and the
 * resolution fails for a reason nobody in the room can see.
 */
export function meetsThreshold(
  shares: number,
  total: number,
  threshold: Threshold,
): boolean {
  if (total <= 0) return false;
  const left = shares * threshold.denominator;
  const right = total * threshold.numerator;
  return threshold.strict ? left > right : left >= right;
}

/** The smallest share count that reaches the threshold. */
export function sharesNeeded(total: number, threshold: Threshold): number {
  const exact = (total * threshold.numerator) / threshold.denominator;
  if (threshold.strict) return Math.floor(exact) + 1;
  return Math.ceil(exact);
}

export interface QuorumResult {
  readonly totalShares: number;
  readonly presentShares: number;
  readonly inPersonShares: number;
  readonly proxyShares: number;
  readonly requiredShares: number;
  readonly met: boolean;
  /** Present weight in basis points, for display. */
  readonly presentBasisPoints: BasisPoints;
  readonly shortBy: number;
}

/**
 * Quorum for a meeting.
 *
 * A unit represented both in person and by proxy counts once. That is not a
 * hypothetical: a shareholder sends a proxy, then turns up anyway, and counting
 * both inflates the quorum that authorised every resolution passed that night.
 */
export function computeQuorum(input: {
  readonly holdings: readonly ShareHolding[];
  readonly presentUnitIds: readonly string[];
  readonly proxyUnitIds: readonly string[];
  readonly threshold: Threshold;
}): QuorumResult {
  const { holdings, presentUnitIds, proxyUnitIds, threshold } = input;

  const sharesByUnit = new Map(holdings.map((h) => [h.unitId, h.shares]));
  const total = totalShares(holdings);

  const inPerson = new Set(presentUnitIds.filter((id) => sharesByUnit.has(id)));
  const byProxy = new Set(
    proxyUnitIds.filter((id) => sharesByUnit.has(id) && !inPerson.has(id)),
  );

  const sum = (ids: Set<string>) =>
    [...ids].reduce((acc, id) => acc + (sharesByUnit.get(id) ?? 0), 0);

  const inPersonShares = sum(inPerson);
  const proxyShares = sum(byProxy);
  const presentShares = inPersonShares + proxyShares;
  const requiredShares = sharesNeeded(total, threshold);

  return {
    totalShares: total,
    presentShares,
    inPersonShares,
    proxyShares,
    requiredShares,
    met: meetsThreshold(presentShares, total, threshold),
    presentBasisPoints: weightOf(presentShares, total),
    shortBy: Math.max(0, requiredShares - presentShares),
  };
}

export interface VoteTally {
  readonly sharesFor: number;
  readonly sharesAgainst: number;
  readonly sharesAbstain: number;
}

/**
 * Whether a resolution carried.
 *
 * Measured against shares *voted*, with abstentions excluded. Co-op bylaws
 * differ on this and some count abstentions against, so `base` makes the choice
 * explicit rather than burying an assumption in the arithmetic.
 */
export function resolutionPassed(
  tally: VoteTally,
  threshold: Threshold = MAJORITY,
  base: "voted" | "present" | "outstanding" = "voted",
  totalOutstanding?: number,
): boolean {
  const voted = tally.sharesFor + tally.sharesAgainst;
  const present = voted + tally.sharesAbstain;

  const denominator =
    base === "voted" ? voted : base === "present" ? present : (totalOutstanding ?? 0);

  return meetsThreshold(tally.sharesFor, denominator, threshold);
}

/** "60.0%" — display only. */
export function formatBasisPoints(basisPoints: BasisPoints): string {
  return `${(basisPoints / 100).toFixed(1)}%`;
}

/**
 * Allocates a total cost across units in proportion to shares, in whole cents,
 * guaranteeing the parts sum exactly to the whole.
 *
 * Naive per-unit rounding loses or invents cents, and an assessment that does
 * not add up to the amount the board voted is an assessment somebody disputes.
 * The remainder goes to the largest holders first — the same convention as
 * apportioning seats — so the distribution is deterministic and explicable.
 */
export function allocateByShares(
  totalCents: number,
  holdings: readonly ShareHolding[],
): Map<string, number> {
  const total = totalShares(holdings);
  const out = new Map<string, number>();
  if (total <= 0) return out;

  let allocated = 0;
  const remainders: Array<{ unitId: string; remainder: number; shares: number }> = [];

  for (const holding of holdings) {
    const exact = (totalCents * holding.shares) / total;
    const floor = Math.floor(exact);
    out.set(holding.unitId, floor);
    allocated += floor;
    remainders.push({
      unitId: holding.unitId,
      remainder: exact - floor,
      shares: holding.shares,
    });
  }

  remainders.sort((a, b) => b.remainder - a.remainder || b.shares - a.shares);

  let leftover = totalCents - allocated;
  for (const entry of remainders) {
    if (leftover <= 0) break;
    out.set(entry.unitId, (out.get(entry.unitId) ?? 0) + 1);
    leftover -= 1;
  }

  return out;
}
