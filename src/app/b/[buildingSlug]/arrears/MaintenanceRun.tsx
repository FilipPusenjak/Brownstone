"use client";

import { useMemo, useState, useTransition } from "react";
import { Button, Field, inputClass } from "~/components/patterns/Button";
import { formatAmount, formatMoney, money, parseMoney } from "~/lib/money";
import { allocateByShares } from "~/lib/primitives/shares";
import { postMaintenanceAction } from "./actions";

/**
 * The monthly maintenance run.
 *
 * The preview is the point. Posting maintenance is the single largest money
 * action a treasurer takes, it lands on every neighbour at once, and undoing it
 * means reversing a charge per apartment — so the split is shown before
 * anything is written, not after.
 *
 * The preview is computed here from the same `allocateByShares` the server
 * uses, which makes it exact rather than indicative: same function, same
 * integer arithmetic, remainder to the largest holders. The server recomputes
 * from the share register as of the due date and remains the authority; if a
 * transfer were recorded between this render and the submit, the server's
 * numbers win and the result panel shows what was actually posted.
 */
export function MaintenanceRun({
  buildingSlug,
  units,
  defaultDueOn,
}: {
  buildingSlug: string;
  units: ReadonlyArray<{ id: string; label: string; shares: number }>;
  defaultDueOn: string;
}) {
  const [open, setOpen] = useState(false);
  const [total, setTotal] = useState("");
  const [dueOn, setDueOn] = useState(defaultDueOn);
  const [memo, setMemo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [posted, setPosted] = useState<{ charged: number; totalCents: number } | null>(
    null,
  );
  const [pending, startTransition] = useTransition();

  const holdings = useMemo(() => units.filter((unit) => unit.shares > 0), [units]);

  const preview = useMemo(() => {
    const cents = parseMoney(total);
    if (cents === null || cents <= 0) return null;

    const split = allocateByShares(
      cents,
      holdings.map((unit) => ({ unitId: unit.id, shares: unit.shares })),
    );

    return holdings.map((unit) => ({
      label: unit.label,
      shares: unit.shares,
      amountCents: split.get(unit.id) ?? 0,
    }));
  }, [total, holdings]);

  function post(): void {
    setError(null);
    setFieldError({});

    startTransition(async () => {
      const result = await postMaintenanceAction({
        buildingSlug,
        dueOn,
        total,
        memo: memo || null,
      });

      if (result.ok) {
        setPosted({ charged: result.data.charged, totalCents: result.data.totalCents });
        setOpen(false);
        setTotal("");
        setMemo("");
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  return (
    <div>
      {posted ? (
        <div className="border-complete-line bg-complete-soft mb-4 border-l-2 px-3 py-2">
          <p className="text-ironwork text-sm">
            {formatMoney(money(posted.totalCents))} posted across {posted.charged}{" "}
            {posted.charged === 1 ? "apartment" : "apartments"}.
          </p>
        </div>
      ) : null}

      {error ? (
        <p role="alert" className="text-stamp mb-3 text-sm">
          {error}
        </p>
      ) : null}

      {!open ? (
        <Button intent="primary" onClick={() => setOpen(true)}>
          Post monthly maintenance
        </Button>
      ) : (
        <div className="sheet px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label="Total to collect"
              hint="What the building needs this month, before it's split."
              error={fieldError["total"] ?? fieldError["totalCents"]}
            >
              <input
                inputMode="decimal"
                value={total}
                onChange={(event) => setTotal(event.target.value)}
                className={inputClass}
                placeholder="12,000.00"
              />
            </Field>

            <Field
              label="Due date"
              hint="Shares are read as of this date."
              error={fieldError["dueOn"]}
            >
              <input
                type="date"
                value={dueOn}
                onChange={(event) => setDueOn(event.target.value)}
                className={inputClass}
              />
            </Field>
          </div>

          <div className="mt-3">
            <Field label="Memo" hint="Appears on every charge. Optional.">
              <input
                value={memo}
                onChange={(event) => setMemo(event.target.value)}
                className={inputClass}
                placeholder="Monthly maintenance"
              />
            </Field>
          </div>

          {preview ? (
            <div className="mt-4">
              <p className="eyebrow border-limestone mb-2 border-b pb-1.5">
                How it splits
              </p>
              <ul className="divide-limestone divide-y">
                {preview.map((line) => (
                  <li
                    key={line.label}
                    className="flex items-baseline justify-between gap-4 py-1.5"
                  >
                    <span className="text-ironwork font-mono text-xs">
                      {line.label}
                    </span>
                    <span className="text-ironwork-faint flex-1 font-mono text-[0.6875rem]">
                      {line.shares.toLocaleString("en-US")} shares
                    </span>
                    <span className="text-ironwork font-mono text-xs">
                      {formatAmount(money(line.amountCents))}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-ironwork-faint mt-2 text-xs">
                Split by share allocation. The parts add up to the total exactly — the
                remainder from rounding goes to the largest holders a cent at a time.
              </p>
            </div>
          ) : null}

          <div className="mt-4 flex gap-2">
            <Button
              intent="primary"
              size="sm"
              disabled={pending || !preview}
              onClick={post}
            >
              {pending
                ? "Posting…"
                : preview
                  ? `Post to ${preview.length} apartments`
                  : "Enter a total"}
            </Button>
            <Button intent="quiet" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
