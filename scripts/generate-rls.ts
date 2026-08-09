/**
 * Emits the row-level security migration.
 *
 * Rather than hand-writing a policy per table — which is precisely the process
 * that misses the fortieth table — this reads the applied schema and derives
 * the policy set from a single rule: **every table with a `buildingId` column
 * gets tenant isolation**. The same query backs
 * tests/tenancy/coverage.test.ts, so a table added without a policy fails CI
 * rather than quietly serving another building's rows.
 *
 *   pnpm tsx scripts/generate-rls.ts            # print SQL
 *   pnpm tsx scripts/generate-rls.ts --write    # write a timestamped migration
 *
 * Run it after any migration that adds a tenant table.
 */
import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const APP_ROLE = process.env["APP_DB_ROLE"] ?? "cooperator_app";

/**
 * Tables the application may only append to. Enforced by withholding UPDATE and
 * DELETE from the runtime role, so "append-only" survives a developer who
 * reaches for `prisma.auditLog.update` at 11pm.
 */
const APPEND_ONLY = ["AuditLog", "Charge", "Payment"];

/**
 * The tenant root keys on `id`, not `buildingId`, so a query that only looks
 * for a `buildingId` column leaves the Building table itself wide open — every
 * co-op's name and address readable by any authenticated session. It is the
 * one table the naive rule misses and the most embarrassing one to miss.
 */
const TENANT_ROOT = "Building";

export const TENANT_TABLE_QUERY = `
  SELECT c.table_name
  FROM information_schema.columns c
  JOIN information_schema.tables t
    ON t.table_schema = c.table_schema AND t.table_name = c.table_name
  WHERE c.table_schema = 'public'
    AND c.column_name = 'buildingId'
    AND t.table_type = 'BASE TABLE'
  ORDER BY c.table_name
`;

/** Every table requiring a tenant_isolation policy, root included. */
export async function tenantTables(client: Client): Promise<string[]> {
  const { rows } = await client.query<{ table_name: string }>(TENANT_TABLE_QUERY);
  return [TENANT_ROOT, ...rows.map((r) => r.table_name)].sort();
}

/** The column carrying the tenant key for a given table. */
export function tenantColumn(table: string): string {
  return table === TENANT_ROOT ? "id" : "buildingId";
}

function policyFor(table: string): string {
  // NULLIF guards the empty string: an unset GUC returns NULL and filters
  // every row (fail closed), but ''::uuid would raise instead, and an error is
  // a worse failure mode than an empty list on a page nobody should see.
  const predicate = `"${tenantColumn(table)}" = NULLIF(current_setting('app.current_building_id', true), '')::uuid`;

  return `-- ${table}
ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "${table}";
CREATE POLICY tenant_isolation ON "${table}"
  USING (${predicate})
  WITH CHECK (${predicate});`;
}

function grants(tables: string[]): string {
  const appendOnly = tables.filter((t) => APPEND_ONLY.includes(t));

  return `-- Runtime role grants.
--
-- The app role owns nothing, so it needs explicit privileges. It is also never
-- granted UPDATE or DELETE on the append-only tables: a correction to the
-- ledger is a reversing entry, and an audit log that can be edited is not an
-- audit log.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APP_ROLE}') THEN
    RAISE NOTICE 'Role ${APP_ROLE} does not exist; skipping grants. Run pnpm db:setup.';
    RETURN;
  END IF;

  EXECUTE 'GRANT USAGE ON SCHEMA public TO ${APP_ROLE}';
  EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}';

${appendOnly
  .map((t) => `  EXECUTE 'REVOKE UPDATE, DELETE ON "${t}" FROM ${APP_ROLE}';`)
  .join("\n")}

  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APP_ROLE}';
  EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APP_ROLE}';
END
$$;`;
}

/**
 * Sign-in is the one read that legitimately crosses tenants: before a building
 * is resolved there is no `app.current_building_id`, and a person may hold
 * memberships in two co-ops. Rather than punching an RLS bypass for it, two
 * narrow SELECT-only policies cover exactly that bootstrap.
 *
 * Both are plain column comparisons. A policy containing a subquery against
 * another RLS-protected table recurses in Postgres, and working around that
 * needs a SECURITY DEFINER function — far more machinery, and far more places
 * to get it subtly wrong, than passing the ids the bootstrap already read.
 *
 * Permissive policies OR together, so these widen reads for the signed-in user
 * without loosening `tenant_isolation` for anything else.
 */
function bootstrapPolicies(): string {
  return `-- Sign-in bootstrap.
--
-- src/lib/db/context.ts opens one transaction that sets app.current_user_id,
-- reads that user's own memberships, sets app.member_building_ids from the
-- result, and then reads those buildings. Nothing else in the application is
-- permitted to cross a tenant boundary.

-- A person can always read their own membership rows, in any building.
DROP POLICY IF EXISTS member_self ON "Membership";
CREATE POLICY member_self ON "Membership"
  FOR SELECT
  USING ("userId" = NULLIF(current_setting('app.current_user_id', true), '')::uuid);

-- A building is readable when the bootstrap step has already established, from
-- that user's own membership rows, that they belong to it.
DROP POLICY IF EXISTS member_bootstrap ON "Building";
CREATE POLICY member_bootstrap ON "Building"
  FOR SELECT
  USING (
    "id" = ANY(
      string_to_array(
        NULLIF(current_setting('app.member_building_ids', true), ''), ','
      )::uuid[]
    )
  );

-- Background jobs.
--
-- The daily reminder run must find work in every building, and the delivery
-- webhook arrives knowing a provider message id and nothing else. Both need to
-- answer "which building?" before any scoped work can start.
--
-- The grant is the smallest thing that answers it: reading the tenant registry
-- and reading notifications, both SELECT only. Everything else still requires
-- app.current_building_id, so a job resolves the building here and then does
-- its real work inside withBuildingTx.
DROP POLICY IF EXISTS job_building_scan ON "Building";
CREATE POLICY job_building_scan ON "Building"
  FOR SELECT
  USING (current_setting('app.job_scope', true) = 'all_buildings');

DROP POLICY IF EXISTS job_notification_scan ON "Notification";
CREATE POLICY job_notification_scan ON "Notification"
  FOR SELECT
  USING (current_setting('app.job_scope', true) = 'all_buildings');

-- Invitation redemption.
--
-- Someone following an invitation link has, by definition, no membership yet,
-- so there is no tenant to resolve and tenant_isolation would hide the row that
-- is about to grant them one.
--
-- The scope is one row wide: the policy matches on the token hash the caller
-- has already presented, so even a session that sets this setting sees only the
-- invitation it can already produce a token for. Enumerating invitations is not
-- possible, and neither is reading anything else in the building — the rest of
-- redemption happens inside withBuildingTx once the row names its building.
DROP POLICY IF EXISTS invitation_by_token ON "Invitation";
CREATE POLICY invitation_by_token ON "Invitation"
  FOR SELECT
  USING (
    "tokenHash" = NULLIF(current_setting('app.invitation_token_hash', true), '')
  );`;
}

export function buildSql(tables: string[]): string {
  return `-- Row-level security: the second layer of tenant isolation.
--
-- The application layer is the real defence — every query goes through
-- src/lib/db/scoped/* holding a BuildingContext. This is what catches the
-- mistake when someone routes around it.
--
-- Each request runs inside a transaction that issues
--   SET LOCAL app.current_building_id = '<uuid>'
-- A query that escapes that wrapper has no setting, the predicate evaluates to
-- NULL, and it returns zero rows. Fail closed, never fail open.
--
-- FORCE ROW LEVEL SECURITY matters as much as ENABLE: without it the table
-- owner is exempt, and an app connecting as the owner would have policies that
-- do exactly nothing.
--
-- Generated by scripts/generate-rls.ts. Regenerate after adding a tenant table.
-- ${tables.length} tenant tables.

${tables.map(policyFor).join("\n\n")}

${bootstrapPolicies()}

${grants(tables)}
`;
}

async function main(): Promise<void> {
  const url = process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"];
  if (!url) throw new Error("DIRECT_URL is not set.");

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    const tables = await tenantTables(client);
    if (tables.length === 0) {
      throw new Error(
        "No tables with a buildingId column found. Apply the schema migration first.",
      );
    }

    const sql = buildSql(tables);

    if (process.argv.includes("--write")) {
      const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
      const dir = join("prisma", "migrations", `${stamp}_row_level_security`);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "migration.sql"), sql);
      console.info(`Wrote ${dir}/migration.sql (${tables.length} tables)`);
    } else {
      console.info(sql);
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1]?.includes("generate-rls")) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
