/**
 * Creates the two database roles Co-operator needs, plus the development and
 * test databases.
 *
 * Row-level security is only a real defence if the runtime role cannot ignore
 * it. Postgres exempts a table's owner from RLS unless the table is marked
 * FORCE ROW LEVEL SECURITY, and exempts superusers unconditionally. So:
 *
 *   cooperator_owner  owns the schema, runs migrations, never serves a request
 *   cooperator_app    serves every request, owns nothing, no BYPASSRLS
 *
 * Run once against a fresh server. Idempotent — safe to re-run.
 *
 *   pnpm db:setup
 *
 * Requires ADMIN_DATABASE_URL pointing at a superuser connection. On a managed
 * host (Neon, Supabase, RDS) run the equivalent SQL through their console
 * instead; the statements are printed with --dry-run.
 */
import "dotenv/config";
import { Client } from "pg";

const OWNER = "cooperator_owner";
const APP = "cooperator_app";

const ownerPassword = process.env["DB_OWNER_PASSWORD"] ?? "owner";
const appPassword = process.env["DB_APP_PASSWORD"] ?? "app";
const databases = (process.env["DB_NAMES"] ?? "cooperator,cooperator_test").split(",");

function statements(): string[] {
  const out = [
    `CREATE ROLE ${OWNER} LOGIN PASSWORD '${ownerPassword}';`,
    `CREATE ROLE ${APP} LOGIN PASSWORD '${appPassword}';`,
  ];
  for (const db of databases) {
    out.push(`CREATE DATABASE ${db.trim()} OWNER ${OWNER};`);
  }
  return out;
}

async function main(): Promise<void> {
  if (process.argv.includes("--dry-run")) {
    console.info(statements().join("\n"));
    return;
  }

  const adminUrl = process.env["ADMIN_DATABASE_URL"];
  if (!adminUrl) {
    throw new Error(
      "ADMIN_DATABASE_URL is not set. It needs a superuser connection (for example " +
        "postgresql://postgres@localhost:5432/postgres). Run with --dry-run to print " +
        "the SQL and apply it by hand instead.",
    );
  }

  const client = new Client({ connectionString: adminUrl });
  await client.connect();

  try {
    for (const sql of statements()) {
      try {
        await client.query(sql);
        console.info(`ok    ${sql}`);
      } catch (error) {
        const code = (error as { code?: string }).code;
        // 42710 duplicate_object (role exists), 42P04 duplicate_database
        if (code === "42710" || code === "42P04") {
          console.info(`exists ${sql}`);
          continue;
        }
        throw error;
      }
    }
  } finally {
    await client.end();
  }

  console.info(
    `\nRoles ready. Migrations connect as ${OWNER} (DIRECT_URL); the app connects as ${APP} (DATABASE_URL).`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
