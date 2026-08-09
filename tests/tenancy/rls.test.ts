import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tenantColumn, tenantTables } from "../../scripts/generate-rls";
import { buildingIds } from "../helpers/context";

/**
 * Row-level security, tested from below the application.
 *
 * `isolation.test.ts` proves the scoped query layer behaves. This proves the
 * database does too — connecting as the same unprivileged role the app uses,
 * issuing raw SQL, and bypassing every line of TypeScript in the project.
 *
 * That distinction matters. The application layer is the real defence; RLS is
 * what catches the mistake. A test that only exercises the code it is defending
 * against cannot tell you the second layer exists.
 *
 * Every tenant table is checked, enumerated from the live schema, so this stays
 * complete as the schema grows.
 */

describe("row-level security", () => {
  let client: Client;
  let tables: string[];
  let adelaideId: string;
  let lispenardId: string;

  beforeAll(async () => {
    // The application's role: owns nothing, holds no BYPASSRLS.
    client = new Client({ connectionString: process.env["DATABASE_URL"] });
    await client.connect();
    tables = await tenantTables(client);
    ({ adelaide: adelaideId, lispenard: lispenardId } = await buildingIds());
  });

  afterAll(async () => {
    await client.end();
  });

  it("covers every tenant table", () => {
    expect(tables.length).toBeGreaterThan(30);
    expect(tables).toContain("Building");
    expect(tables).toContain("MembershipUnit");
    expect(tables).toContain("AuditLog");
  });

  it("returns nothing at all when no building is set — fails closed", async () => {
    await client.query("BEGIN");
    try {
      for (const table of tables) {
        const { rows } = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM "${table}"`,
        );
        expect(
          { table, count: rows[0]?.count },
          `${table} returned rows with no app.current_building_id set`,
        ).toEqual({ table, count: "0" });
      }
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("returns only the active building's rows", async () => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL app.current_building_id = '${adelaideId}'`);

      for (const table of tables) {
        const column = tenantColumn(table);
        const { rows } = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM "${table}" WHERE "${column}" <> $1`,
          [adelaideId],
        );
        expect(
          { table, count: rows[0]?.count },
          `${table} leaked rows from another building`,
        ).toEqual({ table, count: "0" });
      }
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("hides the other building's units even though the labels match", async () => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL app.current_building_id = '${adelaideId}'`);
      const { rows } = await client.query<{ id: string; buildingId: string }>(
        `SELECT id, "buildingId" FROM "Unit" WHERE label = '3R'`,
      );

      // Both buildings have a 3R. Exactly one of them may be visible.
      expect(rows).toHaveLength(1);
      expect(rows[0]?.buildingId).toEqual(adelaideId);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("refuses to write a row into another building", async () => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL app.current_building_id = '${adelaideId}'`);

      await expect(
        client.query(
          `INSERT INTO "Unit" ("buildingId", label, "floorIndex") VALUES ($1, 'SMUGGLED', 9)`,
          [lispenardId],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("cannot be tricked by an empty setting", async () => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL app.current_building_id = ''`);
      const { rows } = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM "Obligation"`,
      );
      expect(rows[0]?.count).toEqual("0");
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("keeps the ledger and the audit log append-only", async () => {
    // Each statement gets its own transaction: Postgres aborts a transaction on
    // the first error, and every later statement then reports "transaction is
    // aborted" instead of the permission error we are actually asserting on.
    const expectDenied = async (sql: string): Promise<void> => {
      await client.query("BEGIN");
      try {
        await client.query(`SET LOCAL app.current_building_id = '${adelaideId}'`);
        await expect(client.query(sql), sql).rejects.toThrow(/permission denied/i);
      } finally {
        await client.query("ROLLBACK");
      }
    };

    // The runtime role is never granted UPDATE or DELETE on these tables, so a
    // correction has to be a reversing entry, and an audit record cannot be
    // rewritten after the fact.
    for (const table of ["AuditLog", "Charge", "Payment"]) {
      await expectDenied(`UPDATE "${table}" SET "buildingId" = "buildingId"`);
      await expectDenied(`DELETE FROM "${table}"`);
    }
  });

  it("still allows the ledger to be appended to", async () => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL app.current_building_id = '${adelaideId}'`);
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM "Unit" LIMIT 1`,
      );
      const unitId = rows[0]?.id;
      expect(unitId).toBeDefined();

      // Append-only means append *is* allowed — the restriction would be
      // useless if it also blocked recording a payment.
      await expect(
        client.query(
          `INSERT INTO "Payment" ("buildingId", "unitId", "amountCents", "receivedOn", method)
           VALUES ($1, $2, 1000, CURRENT_DATE, 'CHECK')`,
          [adelaideId, unitId],
        ),
      ).resolves.toBeDefined();
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("confines the background job scope to the tenant registry", async () => {
    // Background jobs need to answer "which building?" before any scoped work
    // can start. The grant is deliberately just Building and Notification; if
    // it ever widened, a compromised job would become a full read of every
    // co-op's records.
    //
    // Self-contained on purpose: the notification it reads is written inside
    // this transaction and rolled back, so the assertion never depends on
    // another suite having run first.
    const permitted = new Set(["Building", "Notification"]);

    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL app.current_building_id = '${adelaideId}'`);
      await client.query(
        `INSERT INTO "Notification"
           ("buildingId", "recipientEmail", template, subject, payload, "textBody", "dedupeKey")
         VALUES ($1, 'probe@example.com', 'probe', 'probe', '{}'::jsonb, 'probe', $2)`,
        [adelaideId, `job-scope-probe-${Date.now()}`],
      );

      // Drop the tenant and pick up the job scope.
      await client.query(`SET LOCAL app.current_building_id = ''`);
      await client.query(`SET LOCAL app.job_scope = 'all_buildings'`);

      for (const table of tables) {
        const { rows } = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM "${table}"`,
        );
        const visible = Number(rows[0]?.count ?? "0");

        if (permitted.has(table)) {
          expect(
            visible,
            `${table} should be readable under the job scope`,
          ).toBeGreaterThan(0);
        } else {
          expect(
            { table, visible },
            `${table} is readable under the job scope and should not be`,
          ).toEqual({ table, visible: 0 });
        }
      }
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("gives the job scope no way to write", async () => {
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL app.job_scope = 'all_buildings'`);
      // The job policies are FOR SELECT. Writing still needs a tenant.
      await expect(
        client.query(
          `INSERT INTO "Unit" ("buildingId", label, "floorIndex")
           SELECT id, 'JOBWRITE', 9 FROM "Building" LIMIT 1`,
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("confines the invitation scope to the single row whose token is presented", async () => {
    // The one pre-tenant read in the product: a visitor holding an invitation
    // link has no membership yet. The database hands over exactly the row whose
    // hash they can already produce — so the scope cannot be used to enumerate
    // invitations, and cannot be used to read anything else at all.
    await client.query("BEGIN");
    try {
      await client.query(`SET LOCAL app.current_building_id = '${adelaideId}'`);

      const mine = `rls-probe-${Date.now().toString(16)}`.padEnd(64, "0");
      const theirs = `rls-other-${Date.now().toString(16)}`.padEnd(64, "0");

      for (const [buildingId, hash] of [
        [adelaideId, mine],
        [adelaideId, theirs],
      ] as const) {
        await client.query(
          `INSERT INTO "Invitation"
             ("buildingId", email, roles, "unitIds", "tokenHash", "expiresAt",
              "invitedByMembershipId")
           SELECT $1, 'probe@example.com', ARRAY['SHAREHOLDER']::"Role"[],
                  ARRAY[]::uuid[], $2, now() + interval '14 days', m.id
           FROM "Membership" m WHERE m."buildingId" = $1 LIMIT 1`,
          [buildingId, hash],
        );
      }

      // Drop the tenant and pick up the invitation scope.
      await client.query(`SET LOCAL app.current_building_id = ''`);
      await client.query(`SET LOCAL app.invitation_token_hash = '${mine}'`);

      const { rows: visible } = await client.query<{ tokenHash: string }>(
        `SELECT "tokenHash" FROM "Invitation"`,
      );
      expect(visible.map((row) => row.tokenHash)).toEqual([mine]);

      for (const table of tables) {
        if (table === "Invitation") continue;
        const { rows } = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count FROM "${table}"`,
        );
        expect(
          { table, count: rows[0]?.count },
          `${table} is readable under the invitation scope and should not be`,
        ).toEqual({ table, count: "0" });
      }
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("gives the invitation scope no way to write", async () => {
    // The policy is FOR SELECT. Marking an invitation accepted still happens
    // inside withBuildingTx, under tenant isolation like everything else — so a
    // caller holding a token can read their invitation and change nothing.
    await client.query("BEGIN");
    try {
      const hash = `rls-write-${Date.now().toString(16)}`.padEnd(64, "0");

      await client.query(`SET LOCAL app.current_building_id = '${adelaideId}'`);
      await client.query(
        `INSERT INTO "Invitation"
           ("buildingId", email, roles, "unitIds", "tokenHash", "expiresAt",
            "invitedByMembershipId")
         SELECT $1, 'probe@example.com', ARRAY['SHAREHOLDER']::"Role"[],
                ARRAY[]::uuid[], $2, now() + interval '14 days', m.id
         FROM "Membership" m WHERE m."buildingId" = $1 LIMIT 1`,
        [adelaideId, hash],
      );

      await client.query(`SET LOCAL app.current_building_id = ''`);
      await client.query(`SET LOCAL app.invitation_token_hash = '${hash}'`);

      // Visible…
      const seen = await client.query(
        `SELECT id FROM "Invitation" WHERE "tokenHash" = $1`,
        [hash],
      );
      expect(seen.rowCount).toEqual(1);

      // …and untouchable. UPDATE has no policy here, so it matches no row.
      const updated = await client.query(
        `UPDATE "Invitation" SET "acceptedAt" = now() WHERE "tokenHash" = $1`,
        [hash],
      );
      expect(updated.rowCount).toEqual(0);

      const deleted = await client.query(
        `DELETE FROM "Invitation" WHERE "tokenHash" = $1`,
        [hash],
      );
      expect(deleted.rowCount).toEqual(0);

      // Minting one outright is refused rather than silently ignored: the
      // insert has no tenant to satisfy tenant_isolation's WITH CHECK.
      await expect(
        client.query(
          `INSERT INTO "Invitation"
             ("buildingId", email, roles, "unitIds", "tokenHash", "expiresAt",
              "invitedByMembershipId")
           VALUES ($1, 'forged@example.com', ARRAY['PRESIDENT']::"Role"[],
                   ARRAY[]::uuid[], $2, now() + interval '14 days', $3)`,
          [adelaideId, `${hash.slice(0, 60)}ffff`, seen.rows[0]?.["id"]],
        ),
      ).rejects.toThrow(/row-level security/i);
    } finally {
      await client.query("ROLLBACK");
    }
  });

  it("does not let the setting survive a transaction", async () => {
    await client.query("BEGIN");
    await client.query(`SET LOCAL app.current_building_id = '${adelaideId}'`);
    await client.query("COMMIT");

    // SET LOCAL dies with the transaction. If it did not, a pooled connection
    // would carry one request's tenant into the next request that borrowed it.
    const { rows } = await client.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM "Unit"`,
    );
    expect(rows[0]?.count).toEqual("0");
  });
});
