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
  ignores: ["src/lib/db/**", "prisma/**", "scripts/**", "tests/**"],
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
            group: ["~/generated/prisma", "~/generated/prisma/**", "**/generated/prisma", "**/generated/prisma/**"],
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
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
    },
  },
  prismaImportBoundary,
];

export default config;
