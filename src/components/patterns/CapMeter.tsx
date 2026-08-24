import type { CapReading } from "~/lib/primitives/sublets";

/**
 * The sublet cap, drawn as the apartments it counts.
 *
 * One block per apartment, filled for the ones sublet, with a rule where the
 * lease puts the line. The picture is the point: "one of six, and the lease
 * allows one" lands in a way "20%" does not, and the boundary — the thing a
 * shareholder whose application was refused will argue about — is visible
 * rather than inferred.
 *
 * Blocks, not a bar, because the quantity really is discrete. You cannot sublet
 * a fifth of an apartment, and a continuous bar would suggest you could.
 */
export function CapMeter({ cap }: { cap: CapReading }) {
  const blocks = Array.from({ length: cap.totalUnits }, (_, index) => index);
  const full = cap.allowed !== null && cap.current >= cap.allowed;

  return (
    <div className="sheet px-4 py-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="eyebrow">Sublet against the cap</p>
        <p
          className={`font-mono text-xs ${full ? "text-stamp" : "text-ironwork-soft"}`}
        >
          {cap.capPercent === null
            ? "The lease sets no cap"
            : full
              ? "At the cap"
              : `Room for ${(cap.allowed ?? 0) - cap.current} more`}
        </p>
      </div>

      <div
        className="flex flex-wrap items-end gap-1"
        role="img"
        aria-label={
          cap.capPercent === null
            ? `${cap.current} of ${cap.totalUnits} apartments sublet; the lease sets no cap`
            : `${cap.current} of ${cap.totalUnits} apartments sublet; the lease allows ${cap.allowed}`
        }
      >
        {blocks.map((index) => {
          const sublet = index < cap.current;
          // The rule sits after the last apartment the lease allows.
          const atLine = cap.allowed !== null && index === cap.allowed;

          return (
            <div key={index} className="flex items-end">
              {atLine ? (
                <span className="bg-ironwork mr-1 h-7 w-px" aria-hidden />
              ) : null}
              <span
                className={`h-6 w-6 rounded-[2px] border ${
                  sublet
                    ? "border-verdigris bg-verdigris"
                    : "border-limestone-deep bg-white"
                }`}
              />
            </div>
          );
        })}
      </div>

      <p className="text-ironwork-soft mt-3 font-mono text-[0.6875rem]">
        {cap.current} of {cap.totalUnits} apartments sublet
        {cap.capPercent === null ? null : (
          <>
            {" · "}the lease allows {cap.allowed} ({cap.capPercent}%)
          </>
        )}
      </p>
    </div>
  );
}
