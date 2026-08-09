import type { ElevationUnit, UnitFlag } from "~/components/elevation/BuildingElevation";
import { can } from "~/lib/auth/capabilities";
import { daysBetween, today, toPlainDate } from "~/lib/time";
import type { BuildingContext } from "../context";
import { withBuildingTx } from "../tx";
import { unitFilter, visibility } from "../visibility";

/**
 * The data behind the building elevation.
 *
 * Each cell carries a flag, and what raises one depends on who is looking. A
 * shareholder sees an alteration flag on their own unit; the treasurer sees an
 * arrears flag on every unit. The elevation must never become the place where a
 * shareholder learns which neighbour is behind on maintenance, so the arrears
 * signal is gated on `arrears.viewAll` exactly like the ledger itself.
 */

const COI_WARNING_DAYS = 45;

const SEVERITY: Record<UnitFlag, number> = { overdue: 2, attention: 1, none: 0 };

export async function buildingElevation(
  ctx: BuildingContext,
): Promise<ElevationUnit[]> {
  const now = today(ctx.building.timezone);
  const seesArrears = can(ctx, "arrears.viewAll");
  const alterationView = visibility(ctx, "alteration");

  return withBuildingTx(ctx.building.id, async (tx) => {
    const units = await tx.unit.findMany({
      orderBy: [{ floorIndex: "asc" }, { label: "asc" }],
      select: {
        id: true,
        label: true,
        floorIndex: true,
        shareAllocations: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { shares: true },
        },
        holdings: {
          where: { effectiveTo: null },
          orderBy: { effectiveFrom: "desc" },
          take: 1,
          select: { holderName: true },
        },
      },
    });

    const visibleUnitIds =
      alterationView.scope === "all"
        ? units.map((u) => u.id)
        : alterationView.scope === "units"
          ? [...alterationView.unitIds]
          : [];

    const [openAlterations, expiringCois, arrears] = await Promise.all([
      tx.alterationRequest.findMany({
        where: {
          unitId: { in: visibleUnitIds },
          approval: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
        },
        select: { unitId: true, title: true },
      }),
      tx.certificateOfInsurance.findMany({
        where: { unitId: { not: null } },
        select: { unitId: true, holderName: true, expiresOn: true },
      }),
      seesArrears
        ? tx.charge.findMany({
            where: { dueOn: { lt: new Date() } },
            select: { unitId: true, amountCents: true },
          })
        : Promise.resolve([]),
    ]);

    const paid = seesArrears
      ? await tx.payment.findMany({ select: { unitId: true, amountCents: true } })
      : [];

    const balances = new Map<string, number>();
    for (const charge of arrears) {
      balances.set(
        charge.unitId,
        (balances.get(charge.unitId) ?? 0) + charge.amountCents,
      );
    }
    for (const payment of paid) {
      balances.set(
        payment.unitId,
        (balances.get(payment.unitId) ?? 0) - payment.amountCents,
      );
    }

    return units.map((unit) => {
      // Collect every signal, then take the most severe. Assigning as we go
      // would let a later mild signal quietly overwrite an earlier serious one,
      // and the cell would show "awaiting a decision" on a unit whose insurance
      // has actually lapsed.
      const signals: Array<{ flag: UnitFlag; note: string }> = [];

      const alteration = openAlterations.find((a) => a.unitId === unit.id);
      if (alteration) {
        signals.push({
          flag: "attention",
          note: `${alteration.title} — awaiting a decision`,
        });
      }

      const coi = expiringCois.find((c) => c.unitId === unit.id);
      if (coi) {
        const days = daysBetween(now, toPlainDate(coi.expiresOn));
        if (days < 0) {
          signals.push({
            flag: "overdue",
            note: `${coi.holderName} insurance expired`,
          });
        } else if (days <= COI_WARNING_DAYS) {
          signals.push({
            flag: "attention",
            note: `${coi.holderName} insurance expires in ${days} days`,
          });
        }
      }

      const balance = balances.get(unit.id) ?? 0;
      if (seesArrears && balance > 0) {
        signals.push({
          flag: "overdue",
          note: `${(balance / 100).toLocaleString("en-US", { style: "currency", currency: "USD" })} outstanding`,
        });
      }

      const worst = signals.sort((a, b) => SEVERITY[b.flag] - SEVERITY[a.flag])[0];
      const flag: UnitFlag = worst?.flag ?? "none";
      const note: string | null = worst?.note ?? null;

      return {
        id: unit.id,
        label: unit.label,
        floorIndex: unit.floorIndex,
        shares: unit.shareAllocations[0]?.shares ?? 0,
        holderName: unit.holdings[0]?.holderName ?? null,
        flag,
        note,
      } satisfies ElevationUnit;
    });
  });
}

/** Counts for the overview strip. Cheap, and all building-wide. */
export async function overviewCounts(ctx: BuildingContext) {
  return withBuildingTx(ctx.building.id, async (tx) => {
    const now = new Date();

    const [open, overdue, proposals, expiringCois, pendingAlterations] =
      await Promise.all([
        tx.obligation.count({ where: { state: "OPEN" } }),
        tx.obligation.count({ where: { state: "OPEN", dueOn: { lt: now } } }),
        tx.buildingRuleAssessment.count({ where: { decision: "PROPOSED" } }),
        tx.certificateOfInsurance.count({
          where: {
            expiresOn: { lte: new Date(Date.now() + COI_WARNING_DAYS * 86_400_000) },
          },
        }),
        tx.alterationRequest.count({
          where: {
            ...unitFilter(ctx, "alteration"),
            approval: { status: { in: ["SUBMITTED", "UNDER_REVIEW"] } },
          },
        }),
      ]);

    return { open, overdue, proposals, expiringCois, pendingAlterations };
  });
}
