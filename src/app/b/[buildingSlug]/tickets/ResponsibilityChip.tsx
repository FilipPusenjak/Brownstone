import type { Responsibility } from "~/generated/prisma/enums";

/**
 * Who pays, at a glance.
 *
 * Only the undecided state carries colour. A repair whose responsibility is
 * settled needs no emphasis — it is the ones nobody has answered that stall,
 * because until somebody does, nobody wants to arrange the work.
 */
const STYLES: Record<Responsibility, { label: string; className: string }> = {
  UNDETERMINED: {
    label: "Not decided",
    className: "border-started-line bg-started-soft text-started",
  },
  SHAREHOLDER: {
    label: "Shareholder",
    className: "border-limestone-deep text-ironwork",
  },
  COOPERATIVE: {
    label: "The co-op",
    className: "border-limestone-deep text-ironwork",
  },
  SHARED: { label: "Shared", className: "border-limestone-deep text-ironwork" },
};

export function ResponsibilityChip({ value }: { value: Responsibility }) {
  const style = STYLES[value];

  return (
    <span
      className={`rounded-chip inline-flex shrink-0 items-center border px-1.5 py-0.5 font-mono text-[0.6875rem] tracking-wider uppercase ${style.className}`}
    >
      {style.label}
    </span>
  );
}
