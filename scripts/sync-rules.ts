/**
 * Upserts the compliance ruleset by `code`.
 *
 * The ruleset is reference data, not tenant data, so it is deployed rather than
 * seeded: correcting a citation or a filing date in production must not require
 * touching a single building's records. Run this after any edit to
 * prisma/seed/rules/ruleset.ts, and on deploy.
 *
 *   pnpm rules:sync
 */
import "dotenv/config";
import { RULESET } from "../prisma/seed/rules/ruleset";
import { withUntenantedTx } from "../src/lib/db/tx";

async function main(): Promise<void> {
  let created = 0;
  let updated = 0;

  await withUntenantedTx(async (tx) => {
    for (const rule of RULESET) {
      const existing = await tx.complianceRule.findUnique({
        where: { code: rule.code },
        select: { id: true },
      });

      const data = {
        title: rule.title,
        authority: rule.authority,
        citation: rule.citation,
        sourceUrl: rule.sourceUrl ?? null,
        requirement: rule.requirement,
        appliesWhen: rule.appliesWhen,
        applicability: rule.applicability as never,
        recurrenceType: rule.recurrenceType,
        intervalMonths: rule.intervalMonths ?? null,
        cycleYears: rule.cycleYears ?? null,
        cycleAnchorYear: rule.cycleAnchorYear ?? null,
        cycleGroupSource: rule.cycleGroupSource ?? null,
        dueMonth: rule.dueMonth ?? null,
        dueDay: rule.dueDay ?? null,
        windowOpensMonth: rule.windowOpensMonth ?? null,
        windowOpensDay: rule.windowOpensDay ?? null,
        anchorOffsetMonths: rule.anchorOffsetMonths ?? null,
        reminderOffsets: rule.reminderOffsets,
        needsVerification: rule.needsVerification,
        verificationNote: rule.verificationNote ?? null,
      };

      await tx.complianceRule.upsert({
        where: { code: rule.code },
        create: { code: rule.code, ...data },
        update: data,
      });

      if (existing) updated += 1;
      else created += 1;
    }
  });

  const unverified = RULESET.filter((r) => r.needsVerification).length;

  console.info(
    `Ruleset synced: ${created} added, ${updated} updated, ${RULESET.length} total.`,
  );
  console.info(
    `${unverified} of ${RULESET.length} rules are flagged as needing verification and will show as unverified in the app.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
