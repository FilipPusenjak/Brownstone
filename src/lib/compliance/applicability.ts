/**
 * Which laws apply to this building.
 *
 * Applicability is data, not code. Each rule in the seeded ruleset carries a
 * predicate over the building's physical attributes, and this module evaluates
 * it. There is deliberately no `if (building.stories > 6)` anywhere in
 * Co-operator: the day the facade threshold changes, the fix is a seed row and
 * a citation, not a deploy of new conditionals.
 *
 * Evaluation returns a reason as well as a verdict, because the board is asked
 * to confirm each proposal and "this applies to you" is not a claim anyone
 * should accept without being told why.
 */

export interface BuildingAttributes {
  readonly unitCount: number;
  readonly stories: number;
  readonly yearBuilt: number | null;
  readonly grossSquareFeet: number | null;
  readonly hasElevator: boolean;
  readonly gasService: "NONE" | "COOKING_ONLY" | "HEATING_AND_COOKING" | "UNKNOWN";
  readonly oilTankPresent: boolean;
  readonly sprinklerStatus: "NONE" | "PARTIAL" | "FULL" | "UNKNOWN";
  readonly facadeHeightFt: number | null;
  readonly isLandmarked: boolean;
  readonly hasParapet: boolean;
  readonly ownerOccupied: boolean;
}

export type AttributeKey = keyof BuildingAttributes;

export type Comparison =
  | { readonly attr: AttributeKey; readonly op: "eq" | "ne"; readonly value: string | number | boolean | null }
  | { readonly attr: AttributeKey; readonly op: "gt" | "gte" | "lt" | "lte"; readonly value: number }
  | { readonly attr: AttributeKey; readonly op: "in" | "nin"; readonly value: readonly (string | number | boolean | null)[] };

export type Predicate =
  | Comparison
  | { readonly all: readonly Predicate[] }
  | { readonly any: readonly Predicate[] }
  | { readonly not: Predicate }
  | { readonly always: true };

export interface Verdict {
  readonly applies: boolean;
  /** Plain-language explanation, shown next to the proposal. */
  readonly reason: string;
  /** The attribute values the verdict was computed from, kept for the record. */
  readonly inputs: Partial<BuildingAttributes>;
}

/** Human-readable attribute names, for the reason string. */
const LABELS: Record<AttributeKey, string> = {
  unitCount: "unit count",
  stories: "stories",
  yearBuilt: "year built",
  grossSquareFeet: "gross floor area",
  hasElevator: "elevator",
  gasService: "gas service",
  oilTankPresent: "oil tank",
  sprinklerStatus: "sprinkler system",
  facadeHeightFt: "facade height",
  isLandmarked: "landmark status",
  hasParapet: "parapet",
  ownerOccupied: "owner occupied",
};

const OPS: Record<string, string> = {
  eq: "is",
  ne: "is not",
  gt: "is more than",
  gte: "is at least",
  lt: "is under",
  lte: "is at most",
  in: "is one of",
  nin: "is not one of",
};

/** Attributes whose reason reads better without the building's raw value. */
const BOOLEAN_ATTRS = new Set<AttributeKey>([
  "hasElevator",
  "oilTankPresent",
  "isLandmarked",
  "hasParapet",
  "ownerOccupied",
]);

function isComparison(p: Predicate): p is Comparison {
  return "attr" in p;
}

function describeValue(value: unknown): string {
  if (value === null) return "unknown";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.map(describeValue).join(" or ");
  return String(value);
}

function evaluateComparison(
  predicate: Comparison,
  attributes: BuildingAttributes,
): { result: boolean; clause: string } {
  const actual = attributes[predicate.attr];
  const label = LABELS[predicate.attr];
  // Quote the building's own number, not just the threshold. "unit count is at
  // least 3" tells a board nothing they can check; "unit count is 6, which is
  // at least 3" lets them see both the rule and their building in one line.
  const clause = BOOLEAN_ATTRS.has(predicate.attr)
    ? `${label} is ${describeValue(actual)}`
    : `${label} is ${describeValue(actual)}, which ${OPS[predicate.op]} ${describeValue(predicate.value)}`;

  // An unknown attribute cannot satisfy a threshold. Treating null as zero
  // would quietly conclude that a building with no recorded floor area is
  // exempt from the benchmarking laws, which is exactly the confidently wrong
  // answer this product must not give.
  if (actual === null || actual === undefined) {
    return { result: false, clause: `${label} is not recorded` };
  }

  switch (predicate.op) {
    case "eq":
      return { result: actual === predicate.value, clause };
    case "ne":
      return { result: actual !== predicate.value, clause };
    case "gt":
      return { result: Number(actual) > predicate.value, clause };
    case "gte":
      return { result: Number(actual) >= predicate.value, clause };
    case "lt":
      return { result: Number(actual) < predicate.value, clause };
    case "lte":
      return { result: Number(actual) <= predicate.value, clause };
    case "in":
      return { result: predicate.value.includes(actual as never), clause };
    case "nin":
      return { result: !predicate.value.includes(actual as never), clause };
  }
}

interface Trace {
  result: boolean;
  /** Clauses that decided the outcome. */
  clauses: string[];
  used: Set<AttributeKey>;
}

function walk(predicate: Predicate, attributes: BuildingAttributes): Trace {
  if ("always" in predicate) {
    return { result: true, clauses: ["it applies to every building"], used: new Set() };
  }

  if (isComparison(predicate)) {
    const { result, clause } = evaluateComparison(predicate, attributes);
    return { result, clauses: [clause], used: new Set([predicate.attr]) };
  }

  if ("not" in predicate) {
    const inner = walk(predicate.not, attributes);
    return {
      result: !inner.result,
      clauses: inner.clauses.map((c) => `not (${c})`),
      used: inner.used,
    };
  }

  if ("all" in predicate) {
    const traces = predicate.all.map((p) => walk(p, attributes));
    const result = traces.every((t) => t.result);
    // When it fails, the useful explanation is the clause that failed, not all
    // of them. When it passes, every clause contributed.
    const relevant = result ? traces : traces.filter((t) => !t.result);
    return {
      result,
      clauses: relevant.flatMap((t) => t.clauses),
      used: new Set(traces.flatMap((t) => [...t.used])),
    };
  }

  const traces = predicate.any.map((p) => walk(p, attributes));
  const result = traces.some((t) => t.result);
  const relevant = result ? traces.filter((t) => t.result) : traces;
  return {
    result,
    clauses: relevant.flatMap((t) => t.clauses),
    used: new Set(traces.flatMap((t) => [...t.used])),
  };
}

export function evaluate(
  predicate: Predicate,
  attributes: BuildingAttributes,
): Verdict {
  const trace = walk(predicate, attributes);

  const inputs: Partial<BuildingAttributes> = {};
  for (const key of trace.used) {
    (inputs as Record<string, unknown>)[key] = attributes[key];
  }

  const joined = trace.clauses.join(", and ");
  const reason = trace.result
    ? `Applies because ${joined}.`
    : `Does not apply because ${joined}.`;

  return { applies: trace.result, reason, inputs };
}

/** Narrows the untyped JSON column back to a Predicate. */
export function asPredicate(value: unknown): Predicate {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("Rule applicability must be an object.");
  }
  return value as Predicate;
}

export function attributesOf(building: BuildingAttributes): BuildingAttributes {
  return {
    unitCount: building.unitCount,
    stories: building.stories,
    yearBuilt: building.yearBuilt,
    grossSquareFeet: building.grossSquareFeet,
    hasElevator: building.hasElevator,
    gasService: building.gasService,
    oilTankPresent: building.oilTankPresent,
    sprinklerStatus: building.sprinklerStatus,
    facadeHeightFt: building.facadeHeightFt,
    isLandmarked: building.isLandmarked,
    hasParapet: building.hasParapet,
    ownerOccupied: building.ownerOccupied,
  };
}
