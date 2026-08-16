import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Building work, driven through a browser.
 *
 * The promise being tested is the one a shareholder reads off the screen: the
 * percentage next to my apartment is my percentage, the money next to it is
 * what I will be charged, and the column adds up to what the job costs. This
 * walks a treasurer through recording a job, reading the split, raising the
 * assessment, and then finds the resulting charge on an apartment's ledger.
 */

const MAIL_DIR = ".mail";
const TREASURER = "desmond.achebe@example.com";

function mailFor(recipient: string, since: number): string[] {
  if (!existsSync(MAIL_DIR)) return [];
  return readdirSync(MAIL_DIR)
    .filter((name) => name.endsWith(".eml"))
    .map((name) => {
      const path = join(MAIL_DIR, name);
      return { body: readFileSync(path, "utf8"), at: statSync(path).mtimeMs };
    })
    .filter((mail) => mail.at >= since && mail.body.includes(`To: ${recipient}`))
    .sort((a, b) => b.at - a.at)
    .map((mail) => mail.body);
}

async function signIn(page: Page, email: string, baseURL: string): Promise<void> {
  const since = Date.now() - 1000;
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();

  const deadline = Date.now() + 15_000;
  let link: string | undefined;
  while (Date.now() < deadline && !link) {
    for (const body of mailFor(email, since)) {
      link = /https?:\/\/[^\s"]+\/api\/auth\/callback\/email\?[^\s"<]+/.exec(body)?.[0];
      if (link) break;
    }
    if (!link) await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!link) throw new Error(`No sign-in link arrived for ${email}`);

  const url = new URL(link);
  const base = new URL(baseURL);
  url.protocol = base.protocol;
  url.host = base.host;

  await page.goto(url.toString(), { waitUntil: "commit" });
  await page.waitForLoadState("domcontentloaded");
}

/** Money out of a cell like "1,234.56". */
function toNumber(text: string): number {
  return Number((/([\d,]+\.\d{2})/.exec(text)?.[1] ?? "0").replace(/,/g, ""));
}

test("a treasurer prices a job, sees the split, and raises the assessment", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  const jobTitle = `Facade repointing ${Date.now().toString(36)}`;
  const estimate = 42_000;

  await signIn(page, TREASURER, base);

  // ---- Record the work ----------------------------------------------------
  await page.goto("/b/adelaide/work");
  await page.getByRole("button", { name: "Add building work" }).click();
  await page.getByLabel("What needs doing").fill(jobTitle);
  await page.getByLabel("Estimated cost").fill("42,000.00");
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // Lands on the new job's page.
  await page.waitForURL(/\/work\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: jobTitle })).toBeVisible();

  // ---- The split, before anything is charged ------------------------------
  await expect(page.getByText("What each apartment would pay")).toBeVisible();

  const rows = page.locator("table tbody tr");
  const rowCount = await rows.count();
  expect(rowCount).toBeGreaterThan(1);

  let summed = 0;
  let percentSummed = 0;
  for (let index = 0; index < rowCount; index += 1) {
    const cells = rows.nth(index).locator("td");
    summed += toNumber((await cells.last().textContent()) ?? "");
    percentSummed += Number(
      /([\d.]+)%/.exec((await cells.nth(3).textContent()) ?? "")?.[1] ?? "0",
    );
  }

  // The parts must add up to the job — this is the claim the page makes.
  expect(summed, "the split must add up to the estimate").toBeCloseTo(estimate, 2);
  expect(percentSummed, "percentages should read as a whole building").toBeGreaterThan(
    99,
  );

  // ---- Raise it -----------------------------------------------------------
  await page.getByRole("button", { name: "Raise this assessment" }).click();
  await page.getByRole("button", { name: "Raise it" }).click();
  // The confirm step exists precisely because this becomes real debt.
  await expect(page.getByText(/posts a charge to all \d+ apartments/)).toBeVisible();
  await page.getByRole("button", { name: "Yes, charge every apartment" }).click();

  await expect(page.getByText("What each apartment was charged")).toBeVisible();
  await expect(page.getByText(/assessed across \d+ apartments/)).toBeVisible();

  // Raising twice is refused, so the button is gone entirely.
  await expect(page.getByRole("button", { name: "Raise this assessment" })).toHaveCount(
    0,
  );

  // ---- And it is real money on a real ledger ------------------------------
  await page.goto("/b/adelaide/arrears");
  await page.locator("table a[href*='/arrears/']").first().click();
  await page.waitForURL(/\/arrears\/[0-9a-f-]{36}/);
  await expect(page.getByText(jobTitle).first()).toBeVisible();
});
