import Link from "next/link";
import { floorTag, stackByFloor, type FloorNaming } from "~/lib/building/floors";

/**
 * The building, as a live object.
 *
 * In a six-unit brownstone you can hold the whole building in your head, and
 * the interface should reflect that. This renders the stack — garden, parlor,
 * second, third — with each unit as a cell.
 *
 * The idea that makes it functional rather than decorative: **cell width is
 * proportional to the unit's share allocation**. Co-op quorum and maintenance
 * are share-weighted, never unit-weighted, so a building where four units hold
 * sixty per cent of the shares should *look* like that. The picture is the
 * share register.
 *
 * One component, three jobs: the dashboard, the unit picker, and (later) the
 * meeting quorum display, where cells fill as proxies arrive.
 *
 * Everything else in the interface stays quiet so this can be the loud thing.
 */

export type UnitFlag = "overdue" | "attention" | "none";

export interface ElevationUnit {
  readonly id: string;
  readonly label: string;
  readonly floorIndex: number;
  readonly shares: number;
  readonly holderName: string | null;
  /** Drives the status edge. `overdue` is stamp red, `attention` yellow. */
  readonly flag: UnitFlag;
  /** One line explaining the flag, e.g. "COI expires in 11 days". */
  readonly note?: string | null;
}

interface Props {
  readonly buildingName: string;
  readonly addressLine1: string;
  readonly floorNaming: FloorNaming;
  readonly units: readonly ElevationUnit[];
  /** Links each cell to a unit page when given. */
  readonly hrefFor?: (unit: ElevationUnit) => string;
  readonly selectedUnitId?: string | null;
}

/** Same vocabulary as the status chips: red is late, yellow needs someone. */
const FLAG_EDGE: Record<UnitFlag, string> = {
  overdue: "bg-stamp",
  attention: "bg-started-line",
  none: "bg-limestone",
};

export function BuildingElevation({
  buildingName,
  addressLine1,
  floorNaming,
  units,
  hrefFor,
  selectedUnitId,
}: Props) {
  const floors = stackByFloor(units);
  const totalShares = units.reduce((sum, unit) => sum + unit.shares, 0);
  const maxFloorShares = Math.max(
    1,
    ...floors.map((floor) => floor.units.reduce((sum, u) => sum + u.shares, 0)),
  );
  const houseNumber = addressLine1.split(" ")[0] ?? "";

  return (
    <section
      aria-label={`${buildingName} — units by floor`}
      className="sheet overflow-hidden"
    >
      {/* The cornice: a heavy band capping the stack, the way the real one caps
          the facade. It is the component header and does no other work. */}
      <header className="border-brownstone bg-paper-sunk flex items-baseline justify-between gap-4 border-b-4 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-display text-brownstone text-3xl leading-none">
            {houseNumber}
          </span>
          <span className="font-display text-ironwork text-lg leading-none">
            {buildingName}
          </span>
        </div>
        <span className="eyebrow whitespace-nowrap">
          {units.length} units · {totalShares.toLocaleString("en-US")} shares
        </span>
      </header>

      <div className="px-4 py-3">
        {floors.map(({ floorIndex, units: floorUnits }) => {
          const floorShares = floorUnits.reduce((sum, u) => sum + u.shares, 0);

          return (
            <div key={floorIndex} className="flex items-stretch gap-3 py-1.5">
              {/* Floor gutter — the vernacular, not a row number. */}
              <div className="flex w-12 shrink-0 items-center justify-end">
                <span className="text-ironwork-faint font-mono text-[0.6875rem] tracking-widest">
                  {floorTag(floorIndex, floorNaming)}
                </span>
              </div>

              {/* The floor's total width is proportional to the shares that
                  floor holds, measured against the heaviest floor in the
                  building. Filling every row edge to edge would make a
                  single-unit floor look as heavy as a floor holding twice the
                  shares, which is precisely the thing this drawing exists to
                  show. The stagger reads as setbacks, which is no accident. */}
              <div
                className="flex min-w-0 gap-1.5"
                style={{ width: `${(floorShares / maxFloorShares) * 100}%` }}
              >
                {floorUnits.map((unit) => (
                  <UnitCell
                    key={unit.id}
                    unit={unit}
                    sharePercent={(unit.shares / Math.max(totalShares, 1)) * 100}
                    href={hrefFor?.(unit)}
                    selected={unit.id === selectedUnitId}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>

      {/* The areaway: the strip below the stoop, carrying building-wide totals. */}
      <footer className="border-limestone bg-paper-sunk flex items-center justify-between gap-4 border-t px-4 py-2">
        <span className="eyebrow">Areaway</span>
        <span className="text-ironwork-soft font-mono text-xs">
          {units.filter((u) => u.flag !== "none").length} units need attention
        </span>
      </footer>
    </section>
  );
}

function UnitCell({
  unit,
  sharePercent,
  href,
  selected,
}: {
  unit: ElevationUnit;
  /** This unit's share of the whole building, for the tooltip. */
  sharePercent: number;
  href?: string;
  selected?: boolean;
}) {
  const share = sharePercent.toFixed(1);

  const body = (
    <>
      {/* The status edge. The only colour in the component, and never
          decorative — an unflagged unit gets limestone, the same as a rule. */}
      <span
        aria-hidden
        className={`absolute inset-x-0 top-0 h-1 ${FLAG_EDGE[unit.flag]}`}
      />
      <span className="text-ironwork block truncate font-mono text-sm font-medium">
        {unit.label}
      </span>
      <span className="text-ironwork-faint block truncate text-xs">
        {unit.holderName ?? "Vacant"}
      </span>
      <span className="text-ironwork-faint mt-1 block font-mono text-[0.6875rem]">
        {unit.shares.toLocaleString("en-US")} sh
      </span>
    </>
  );

  const className = [
    "relative block min-w-0 overflow-hidden border border-limestone bg-paper px-2.5 pb-2 pt-3 text-left",
    selected ? "ring-2 ring-verdigris ring-offset-1 ring-offset-paper" : "",
    href ? "transition-colors hover:bg-paper-sunk" : "",
  ].join(" ");

  const title = unit.note
    ? `${unit.label} — ${unit.note}`
    : `${unit.label} — ${unit.shares} shares, ${share}% of the building`;

  // Minimum width keeps a small-share unit legible; flex-grow shares out the
  // rest so a floor always fills its row.
  const style = { flexGrow: unit.shares, flexBasis: 0, minWidth: "5.5rem" };

  if (!href) {
    return (
      <div className={className} style={style} title={title}>
        {body}
      </div>
    );
  }

  return (
    <Link href={href} className={className} style={style} title={title}>
      {body}
    </Link>
  );
}
