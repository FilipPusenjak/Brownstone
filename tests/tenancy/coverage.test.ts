import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantColumn, tenantTables } from "../../scripts/generate-rls";
import { COVERED_TABLES } from "./isolation.test";

/**
 * The test that keeps the other tests honest.
 *
 * An isolation suite decays the moment someone adds a table and forgets to add
 * it to the suite. This file removes the opportunity: it enumerates tenant
 * tables from the live schema and asserts that each one is protected and
 * covered. Adding a model with a `buildingId` and no policy fails the build,
 * with a message saying exactly what to run.
 */

describe("tenancy coverage", () => {
  let client: Client;
  let tables: string[];

  beforeAll(async () => {
    client = new Client({ connectionString: process.env["DIRECT_URL"] });
    await client.connect();
    tables = await tenantTables(client);
  });

  afterAll(async () => {
    await client.end();
  });

  it("gives every tenant table a tenant_isolation policy", async () => {
    const { rows } = await client.query<{ tablename: string; policyname: string }>(
      `SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'`,
    );
    const withPolicy = new Set(
      rows.filter((r) => r.policyname === "tenant_isolation").map((r) => r.tablename),
    );

    const missing = tables.filter((table) => !withPolicy.has(table));
    expect(
      missing,
      `These tables carry a tenant key but have no RLS policy. ` +
        `Run: pnpm tsx scripts/generate-rls.ts --write && pnpm db:migrate`,
    ).toEqual([]);
  });

  it("forces row-level security, so the table owner is not exempt", async () => {
    const { rows } = await client.query<{
      relname: string;
      relrowsecurity: boolean;
      relforcerowsecurity: boolean;
    }>(
      `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
       FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'`,
    );
    const byName = new Map(rows.map((r) => [r.relname, r]));

    const notEnabled = tables.filter((t) => !byName.get(t)?.relrowsecurity);
    const notForced = tables.filter((t) => !byName.get(t)?.relforcerowsecurity);

    expect(notEnabled, "row-level security is not enabled on these tables").toEqual([]);
    expect(
      notForced,
      "ENABLE without FORCE leaves the table owner exempt, which makes the policy " +
        "decorative for anything running as the owner",
    ).toEqual([]);
  });

  it("names a tenant column on every protected table", () => {
    for (const table of tables) {
      expect(tenantColumn(table)).toEqual(table === "Building" ? "id" : "buildingId");
    }
  });

  it("has a scoped reader exercising every tenant table", () => {
    // Two tables are covered structurally rather than by a list query:
    // Building is the tenant root, proved by every context resolution, and
    // BuildingDataLookup holds raw NYC Open Data payloads with no list view yet.
    const structural = new Set(["Building", "BuildingDataLookup"]);

    const uncovered = tables.filter(
      (table) => !COVERED_TABLES.has(table) && !structural.has(table),
    );

    expect(
      uncovered,
      "These tenant tables have no scoped reader in the isolation suite. Add one to " +
        "src/lib/db/scoped and register it in the READERS list in isolation.test.ts.",
    ).toEqual([]);
  });

  it("leaves identity and shared reference data untenanted, deliberately", async () => {
    const { rows } = await client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
    );
    const all = rows.map((r) => r.table_name);
    const untenanted = all.filter((t) => !tables.includes(t) && t !== "_prisma_migrations");

    // A person is not owned by a building, and the compliance ruleset is the
    // same law for every co-op in the city. Anything else appearing here is an
    // accident.
    expect(untenanted.sort()).toEqual(
      ["Account", "ComplianceRule", "Session", "User", "VerificationToken"].sort(),
    );
  });
});
