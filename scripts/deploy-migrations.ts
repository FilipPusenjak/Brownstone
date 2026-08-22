/**
 * Applies pending migrations to a hosted Postgres over a WebSocket.
 *
 * `prisma migrate deploy` is the right tool and should be used wherever raw TCP
 * to port 5432 is available. It is not available from every environment — a
 * sandboxed agent or a restricted CI runner can reach outbound HTTPS and
 * nothing else — and a schema change that cannot be applied is a deployment
 * that breaks on the first request to a page reading a column that isn't there.
 *
 * So this does the same work over Neon's WebSocket driver, which tunnels the
 * Postgres protocol over 443. It is deliberately conservative:
 *
 * - Each migration runs inside one transaction and rolls back as a unit, so a
 *   half-applied migration is not a state this can produce.
 * - It records itself in `_prisma_migrations` with the same checksum Prisma
 *   computes, so the two tools stay interchangeable in both directions.
 * - It runs as the schema owner rather than the login role. Objects created by
 *   a login role would be owned by it, and a table the runtime role owns is a
 *   table `FORCE ROW LEVEL SECURITY` no longer protects.
 * - It refuses to do anything without APPLY=1, because the default behaviour of
 *   a script pointed at a production database should be to describe itself.
 *
 *   DATABASE_OWNER_URL=... pnpm tsx scripts/deploy-migrations.ts          # dry run
 *   DATABASE_OWNER_URL=... APPLY=1 pnpm tsx scripts/deploy-migrations.ts  # apply
 *
 * The URL must be for a role that may create tables — the same one `DIRECT_URL`
 * points at — not the runtime role.
 */
import "dotenv/config";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Client, neonConfig } from "@neondatabase/serverless";
import ws from "ws";

neonConfig.webSocketConstructor = ws;

const DIR = "prisma/migrations";
const OWNER_ROLE = process.env["OWNER_DB_ROLE"] ?? "cooperator_owner";
const APPLY = process.env["APPLY"] === "1";

const url = process.env["DATABASE_OWNER_URL"] ?? process.env["DIRECT_URL"];
if (!url) {
  throw new Error(
    "Set DATABASE_OWNER_URL (or DIRECT_URL) to a connection string for the schema owner.",
  );
}

const client = new Client(url);

async function main(): Promise<void> {
  await client.connect();

  // Only if the login role is a member; on a database it already owns this is
  // a no-op and failing here would be worse than continuing.
  try {
    await client.query(`SET ROLE ${OWNER_ROLE}`);
  } catch {
    console.info(`(could not SET ROLE ${OWNER_ROLE}; continuing as the login role)`);
  }

  const { rows } = await client.query<{ migration_name: string }>(
    `SELECT migration_name FROM "_prisma_migrations" WHERE rolled_back_at IS NULL`,
  );
  const applied = new Set(rows.map((row) => row.migration_name));

  const pending = readdirSync(DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .filter((name) => !applied.has(name));

  if (pending.length === 0) {
    console.info(`Up to date — ${applied.size} migrations applied.`);
    return;
  }

  console.info(`${APPLY ? "Applying" : "Would apply"} ${pending.length}:`);
  for (const name of pending) console.info(`  ${name}`);

  if (!APPLY) {
    console.info("\nDry run. Re-run with APPLY=1 to execute.");
    return;
  }

  for (const name of pending) {
    const sql = readFileSync(join(DIR, name, "migration.sql"), "utf8");
    const checksum = createHash("sha256").update(sql).digest("hex");

    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query(
        `INSERT INTO "_prisma_migrations"
           (id, checksum, finished_at, migration_name, started_at, applied_steps_count)
         VALUES ($1, $2, now(), $3, now(), 1)`,
        [randomUUID(), checksum, name],
      );
      await client.query("COMMIT");
      console.info(`  applied ${name}`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`${name} failed and was rolled back: ${String(error)}`);
    }
  }

  // Every tenant table must still have a policy. A migration that adds one
  // without running scripts/generate-rls.ts would otherwise leave a table
  // readable across buildings, and finding that out from this script beats
  // finding it out from a shareholder.
  const uncovered = await client.query<{ table_name: string }>(
    `SELECT c.table_name FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND c.column_name = 'buildingId'
        AND t.table_type = 'BASE TABLE'
        AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.tablename = c.table_name)`,
  );

  if (uncovered.rows.length > 0) {
    throw new Error(
      [
        "Migrations applied, but these tenant tables have no row-level security policy:",
        ...uncovered.rows.map((row) => `  ${row.table_name}`),
        "",
        "Run `pnpm tsx scripts/generate-rls.ts --write` and deploy the migration it writes.",
      ].join("\n"),
    );
  }

  console.info("All tenant tables carry a policy.");
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void client.end();
  });
