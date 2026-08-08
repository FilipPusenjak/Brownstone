import { readFile, readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The Prisma import boundary, as a test.
 *
 * eslint.config.mjs already bans these imports. A lint rule can be silenced
 * with a comment on a busy afternoon, and the thing it is protecting — that no
 * query reaches the database without a BuildingContext and a tenant setting —
 * is the one guarantee this product cannot afford to lose quietly.
 *
 * So it is asserted twice, and this one has no inline escape hatch.
 */

const ROOT = join(import.meta.dirname, "..", "..");
const SRC = join(ROOT, "src");

/**
 * Only src/lib/db may touch the client, with one documented exception.
 *
 * Auth.js's Prisma adapter takes a client directly and manages User, Account,
 * Session and VerificationToken — the four tables with no `buildingId` and no
 * RLS policy, because a person is not owned by a building. There is no tenant
 * to scope those reads to, so the adapter gets the raw client and nothing else
 * does.
 */
const ALLOWED = [
  "src/lib/db/prisma.ts",
  "src/lib/db/tx.ts",
  "src/lib/auth/config.ts",
];

const FORBIDDEN = [
  { pattern: /from\s+["']@prisma\/client["']/, what: "@prisma/client" },
  { pattern: /from\s+["'][^"']*generated\/prisma\/client["']/, what: "the generated client" },
  { pattern: /from\s+["'][^"']*lib\/db\/prisma["']/, what: "the raw client module" },
  { pattern: /new\s+PrismaClient\s*\(/, what: "a new PrismaClient" },
];

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "generated" || entry.name === "node_modules") continue;
      files.push(...(await sourceFiles(full)));
    } else if ([".ts", ".tsx"].includes(extname(entry.name))) {
      files.push(full);
    }
  }

  return files;
}

describe("Prisma import boundary", () => {
  it("keeps the client inside src/lib/db", async () => {
    const files = await sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(10);

    const violations: string[] = [];

    for (const file of files) {
      const rel = relative(ROOT, file).replaceAll("\\", "/");
      if (ALLOWED.includes(rel)) continue;

      const contents = await readFile(file, "utf8");
      for (const { pattern, what } of FORBIDDEN) {
        if (pattern.test(contents)) {
          violations.push(`${rel} imports ${what}`);
        }
      }
    }

    expect(
      violations,
      "Data access goes through src/lib/db/scoped/*, which requires a BuildingContext " +
        "and runs inside a transaction that sets app.current_building_id. A direct " +
        "import skips both layers of tenant isolation.",
    ).toEqual([]);
  });

  it("gives every scoped query module a BuildingContext first parameter", async () => {
    const dir = join(SRC, "lib", "db", "scoped");
    const files = await sourceFiles(dir);
    expect(files.length).toBeGreaterThan(3);

    const offenders: string[] = [];
    // Exported async functions whose first parameter is neither a
    // BuildingContext nor a transaction handle passed down from one.
    const exported = /export\s+async\s+function\s+(\w+)\s*\(\s*([^),]*)/g;

    for (const file of files) {
      const contents = await readFile(file, "utf8");
      for (const match of contents.matchAll(exported)) {
        const [, name = "", firstParam = ""] = match;
        const ok =
          /ctx\s*:/.test(firstParam) ||
          /tx\s*:/.test(firstParam) ||
          /buildingId\s*:/.test(firstParam) ||
          firstParam.trim() === "";
        if (!ok) {
          offenders.push(`${relative(ROOT, file)}: ${name}(${firstParam.trim()}…)`);
        }
      }
    }

    expect(
      offenders,
      "Scoped queries take the context first so that getting one is the only way to " +
        "reach building data.",
    ).toEqual([]);
  });
});
