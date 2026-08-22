import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Keeps each scaffolded module honest.
 *
 * Two claims are made about these modules: that the page tells you what is
 * missing, and that the repository does too. Both come from one array, and
 * this asserts they have not been allowed to drift — a TODO.md maintained by
 * hand goes stale the first time someone builds half a module, and then the
 * next developer trusts a list that is wrong.
 */

const ROOT = join(import.meta.dirname, "..", "..", "src", "app", "b", "[buildingSlug]");

const SCAFFOLDS = ["notices", "sublets", "bookings", "tickets", "duty"] as const;

async function missingFromPage(name: string): Promise<string[]> {
  const source = await readFile(join(ROOT, name, "page.tsx"), "utf8");
  const block = source.match(/export const MISSING = \[([\s\S]*?)\];/);
  if (!block?.[1]) return [];

  return [...block[1].matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((match) =>
    (match[1] ?? "").replaceAll('\\"', '"'),
  );
}

async function missingFromTodo(name: string): Promise<string[]> {
  const source = await readFile(join(ROOT, name, "TODO.md"), "utf8");
  return [...source.matchAll(/^- \[ \] (.+)$/gm)].map((match) => match[1] ?? "");
}

describe("module scaffolds", () => {
  it.each(SCAFFOLDS)("%s has a page and a TODO.md", async (name) => {
    const entries = await readdir(join(ROOT, name));
    expect(entries).toContain("page.tsx");
    expect(entries).toContain("TODO.md");
  });

  it.each(SCAFFOLDS)(
    "%s says the same thing on the page and in the repo",
    async (name) => {
      const page = await missingFromPage(name);
      const todo = await missingFromTodo(name);

      expect(page.length).toBeGreaterThan(0);
      expect(
        todo,
        `The TODO.md for ${name} has drifted from its page. Re-run: pnpm tsx scripts/write-module-todos.ts`,
      ).toEqual(page);
    },
  );

  it.each(SCAFFOLDS)("%s writes nothing yet", async (name) => {
    // A clean stub beats a broken feature. A scaffold that quietly discards a
    // repair ticket is worse for a board member than being told to phone the
    // super, so none of these may import a write path or a Server Action.
    const source = await readFile(join(ROOT, name, "page.tsx"), "utf8");

    expect(source).not.toMatch(/"use server"/);
    expect(source).not.toMatch(/-writes"/);
    expect(source).not.toMatch(/from "\.\/actions"/);
  });

  it("marks every scaffold as a stub in the navigation", async () => {
    const shell = await readFile(
      join(
        import.meta.dirname,
        "..",
        "..",
        "src",
        "components",
        "patterns",
        "AppShell.tsx",
      ),
      "utf8",
    );

    for (const name of SCAFFOLDS) {
      const entry = shell.match(new RegExp(`\\{[^}]*href: "/${name}"[^}]*\\}`));
      expect(entry?.[0], `${name} is not in the navigation`).toBeDefined();
      expect(entry?.[0], `${name} is not marked as a stub`).toContain("stub: true");
    }
  });
});
