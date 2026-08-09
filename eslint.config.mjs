import next from "eslint-config-next";

/**
 * The `no-restricted-imports` block below is load-bearing, not style.
 *
 * Co-operator's tenancy guarantee is that every read and write passes through
 * `src/lib/db/scoped/*`, which requires a BuildingContext and runs inside a
 * transaction that sets `app.current_building_id` for row-level security. A
 * single `import { prisma }` in a Server Action routes around both layers.
 *
 * This rule makes that a lint error. `tests/arch/no-direct-prisma.test.ts`
 * makes it a test failure too, so it still fails in CI if someone disables the
 * rule inline.
 */
const prismaImportBoundary = {
  files: ["**/*.ts", "**/*.tsx"],
  ignores: [
    "src/lib/db/**",
    "src/lib/auth/config.ts",
    "prisma/**",
    "scripts/**",
    "tests/**",
  ],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          {
            name: "@prisma/client",
            message:
              "Do not import Prisma directly. Data access goes through src/lib/db/scoped/*, which requires a BuildingContext. See ARCHITECTURE.md.",
          },
        ],
        patterns: [
          {
            // The query surface is off limits; the generated *types* are not.
            // Enums like Role and EntityType are part of the domain vocabulary
            // and belong in capability maps and component props. Banning them
            // would push people to redeclare the enums by hand, which is how
            // they drift out of sync with the schema.
            group: [
              "~/generated/prisma/client",
              "**/generated/prisma/client",
              "~/generated/prisma/internal/**",
              "**/generated/prisma/internal/**",
            ],
            message:
              "Do not import the generated Prisma client directly. Data access goes through src/lib/db/scoped/*, which requires a BuildingContext. See ARCHITECTURE.md.",
          },
          {
            group: ["~/lib/db/prisma", "**/lib/db/prisma"],
            message:
              "The raw client is internal to src/lib/db. Use a scoped query module instead. See ARCHITECTURE.md.",
          },
        ],
      },
    ],
  },
};

const config = [
  ...next,
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "src/generated/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      "storage/**",
      ".mail/**",
    ],
  },
  {
    // App Router only. Without this the Next plugin looks for a pages/
    // directory and warns on every run.
    settings: { next: { rootDir: import.meta.dirname } },
    rules: {
      // Unused locals and parameters are caught by tsconfig's noUnusedLocals
      // and noUnusedParameters, which run in `pnpm verify`. Duplicating them
      // here would need the TypeScript plugin registered in this same config
      // object, for no additional coverage.
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  prismaImportBoundary,
];

export default config;
