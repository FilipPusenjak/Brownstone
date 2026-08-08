import { execFileSync } from "node:child_process";
import { config as loadDotenv } from "dotenv";

/**
 * Prepares the test database once per run: apply migrations, then seed the two
 * buildings.
 *
 * The tenancy suite is only meaningful against a real Postgres with the real
 * policies applied, so there is no in-memory shortcut here. It runs against
 * `cooperator_test` as the same unprivileged role the application uses.
 */
export default async function setup(): Promise<void> {
  loadDotenv({ path: ".env.test", override: true, quiet: true });

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: "test",
    EMAIL_DRIVER: "catcher",
    STORAGE_DRIVER: "local",
  };

  const run = (args: string[]) =>
    execFileSync("pnpm", args, { env, stdio: "pipe", encoding: "utf8" });

  try {
    run(["exec", "prisma", "migrate", "deploy"]);
    run(["tsx", "prisma/seed/index.ts"]);
  } catch (error) {
    const detail =
      error instanceof Error && "stdout" in error
        ? `${String((error as { stdout?: string }).stdout ?? "")}\n${String((error as { stderr?: string }).stderr ?? "")}`
        : String(error);

    throw new Error(
      [
        "Could not prepare the test database.",
        "",
        "The tenancy suite needs a real Postgres with the RLS policies applied.",
        "Run `pnpm db:setup` once to create the roles and databases, then retry.",
        "",
        detail,
      ].join("\n"),
    );
  }
}
