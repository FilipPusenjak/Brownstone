import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * This file configures the Prisma CLI only — migrate, db pull, studio. It is
 * never loaded by the running application.
 *
 * The CLI connects as `cooperator_owner` (DIRECT_URL) because migrations
 * create and alter tables. The application connects as `cooperator_app`
 * (DATABASE_URL), which owns nothing and cannot bypass row-level security.
 * Keeping those two connection strings apart is what makes the RLS policies in
 * prisma/migrations/*_row_level_security real rather than advisory.
 *
 * On Vercel, DATABASE_URL is additionally the pooled connection string and
 * DIRECT_URL is the unpooled one, which is what migrations need anyway.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed/index.ts",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
  },
});
