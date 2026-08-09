/**
 * Floor names, in the words the building uses.
 *
 * A brownstone does not have floors 0 through 4. It has a garden level, a
 * parlor floor, and then numbered floors above. Getting this right is most of
 * why the elevation reads as *this* building rather than a generic stack of
 * boxes — a board member should recognise their own house in it.
 */

export type FloorNaming = "BROWNSTONE" | "NUMERIC";

const BROWNSTONE_NAMES = ["Garden", "Parlor", "Second", "Third", "Fourth", "Fifth"];

export function floorLabel(floorIndex: number, naming: FloorNaming): string {
  if (naming === "BROWNSTONE") {
    return BROWNSTONE_NAMES[floorIndex] ?? `${ordinal(floorIndex)} floor`;
  }
  return floorIndex === 0 ? "Ground" : `${floorIndex}`;
}

/** The short form for the elevation's floor gutter. */
export function floorTag(floorIndex: number, naming: FloorNaming): string {
  if (naming === "BROWNSTONE") {
    // The two named floors keep their names; everything above is an ordinal.
    // Truncating "Second" to "SEC" produces a gutter reading FOU / THI / SEC,
    // which is neither the vernacular nor a number.
    if (floorIndex === 0) return "GDN";
    if (floorIndex === 1) return "PARL";
    return ordinal(floorIndex).toUpperCase();
  }
  return floorIndex === 0 ? "G" : String(floorIndex);
}

function ordinal(n: number): string {
  const suffixes = ["th", "st", "nd", "rd"] as const;
  const remainder = n % 100;
  // 11th, 12th and 13th are the exceptions to the last-digit rule.
  const suffix = remainder >= 11 && remainder <= 13 ? "th" : (suffixes[n % 10] ?? "th");
  return `${n}${suffix}`;
}

/** Groups units into floors, highest floor first — the order a building stacks. */
export function stackByFloor<T extends { floorIndex: number; label: string }>(
  units: readonly T[],
): Array<{ floorIndex: number; units: T[] }> {
  const byFloor = new Map<number, T[]>();

  for (const unit of units) {
    const existing = byFloor.get(unit.floorIndex) ?? [];
    existing.push(unit);
    byFloor.set(unit.floorIndex, existing);
  }

  return [...byFloor.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([floorIndex, floorUnits]) => ({
      floorIndex,
      // Front units before rear, then alphabetical — the order you'd walk them.
      units: [...floorUnits].sort((a, b) => a.label.localeCompare(b.label)),
    }));
}
