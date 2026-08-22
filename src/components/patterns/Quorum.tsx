import {
  formatBasisPoints,
  type QuorumResult,
  type Threshold,
} from "~/lib/primitives/shares";

/**
 * The quorum reading, as a chair would call it from the front of the room.
 *
 * The bar is the building: its full width is every share in the corporation,
 * the filled part is what is represented, and the hairline is where the bylaws
 * put the line. That picture is the point — "we are eighty shares short" means
 * something to a board member in a way that "69.3%" does not, and the two
 * numbers are read off the same object so they cannot disagree.
 *
 * Shares, never apartments. In a building where four of twelve units hold sixty
 * per cent of the stock, a room that looks full can be inquorate.
 */
export function QuorumMeter({
  quorum,
  threshold,
}: {
  quorum: QuorumResult;
  threshold: Threshold;
}) {
  const total = Math.max(quorum.totalShares, 1);
  const present = Math.min(100, (quorum.presentShares / total) * 100);
  const inPerson = Math.min(100, (quorum.inPersonShares / total) * 100);
  const line = Math.min(100, (quorum.requiredShares / total) * 100);

  return (
    <div className="sheet px-4 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="eyebrow">Quorum</p>
        <p
          className={`font-mono text-xs ${quorum.met ? "text-complete" : "text-stamp"}`}
        >
          {quorum.met
            ? "Met"
            : `${quorum.shortBy.toLocaleString("en-US")} shares short`}
        </p>
      </div>

      <div
        className="border-limestone-deep relative h-6 w-full overflow-hidden rounded-[2px] border bg-white"
        role="img"
        aria-label={`${quorum.presentShares.toLocaleString("en-US")} of ${quorum.totalShares.toLocaleString("en-US")} shares represented; ${quorum.requiredShares.toLocaleString("en-US")} needed`}
      >
        {/* Present in the room, then present by proxy — two weights of the
            same colour, because they count the same but are not the same. */}
        <div
          className="bg-verdigris absolute inset-y-0 left-0"
          style={{ width: `${present}%` }}
        />
        <div
          className="bg-verdigris/45 absolute inset-y-0"
          style={{ left: `${inPerson}%`, width: `${present - inPerson}%` }}
        />
        <div
          className="bg-ironwork absolute inset-y-0 w-px"
          style={{ left: `${line}%` }}
          aria-hidden
        />
      </div>

      <dl className="text-ironwork-soft mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 font-mono text-[0.6875rem] sm:grid-cols-4">
        <Reading label="In the room" value={quorum.inPersonShares} />
        <Reading label="By proxy" value={quorum.proxyShares} />
        <Reading
          label="Represented"
          value={quorum.presentShares}
          note={formatBasisPoints(quorum.presentBasisPoints)}
        />
        <Reading
          label={`Needs ${threshold.label}`}
          value={quorum.requiredShares}
          note={`of ${quorum.totalShares.toLocaleString("en-US")}`}
        />
      </dl>
    </div>
  );
}

function Reading({
  label,
  value,
  note,
}: {
  label: string;
  value: number;
  note?: string;
}) {
  return (
    <div>
      <dt className="text-ironwork-faint tracking-wider uppercase">{label}</dt>
      <dd className="text-ironwork">
        {value.toLocaleString("en-US")} sh
        {note ? <span className="text-ironwork-faint"> · {note}</span> : null}
      </dd>
    </div>
  );
}

/** Carried or failed, in the register the minutes use. */
export function OutcomeChip({ passed }: { passed: boolean | null }) {
  if (passed === null) {
    return (
      <span className="rounded-chip border-limestone text-ironwork-faint inline-flex shrink-0 items-center border px-1.5 py-0.5 font-mono text-[0.6875rem] tracking-wider uppercase">
        Not voted
      </span>
    );
  }

  return (
    <span
      className={`rounded-chip inline-flex shrink-0 items-center border px-1.5 py-0.5 font-mono text-[0.6875rem] tracking-wider uppercase ${
        passed
          ? "bg-complete-soft text-complete border-complete-line"
          : "bg-stamp-soft text-stamp border-stamp"
      }`}
    >
      {passed ? "Carried" : "Failed"}
    </span>
  );
}
