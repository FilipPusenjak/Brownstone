import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "~/generated/prisma/client";
import { env } from "~/lib/env";

/**
 * The only place in the application that constructs a Prisma client.
 *
 * Nothing outside `src/lib/db` may import this module — enforced by
 * `no-restricted-imports` in eslint.config.mjs and again by
 * tests/arch/no-direct-prisma.test.ts, because a lint rule can be disabled
 * inline and a test cannot.
 *
 * The client connects as `cooperator_app`, which owns no tables and holds no
 * BYPASSRLS. Every row-level security policy therefore applies to it, and a
 * query issued outside `withBuildingTx` sees nothing at all.
 */

const globalForPrisma = globalThis as unknown as {
  prismaClient: PrismaClient | undefined;
};

function createClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: env().DATABASE_URL });

  return new PrismaClient({
    adapter,
    log:
      env().NODE_ENV === "development"
        ? [{ emit: "stdout", level: "warn" }, { emit: "stdout", level: "error" }]
        : [{ emit: "stdout", level: "error" }],
  });
}

/** @internal Use a module from `src/lib/db/scoped` instead. */
export const prisma: PrismaClient = globalForPrisma.prismaClient ?? createClient();

// Next's dev server re-evaluates modules on every edit; without this the
// connection pool grows until Postgres refuses new connections.
if (env().NODE_ENV !== "production") {
  globalForPrisma.prismaClient = prisma;
}
