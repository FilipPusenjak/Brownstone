import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The ledger, driven through a browser.
 *
 * Money is the one place in this product where "the unit test passed" is not
 * enough reassurance: the treasurer's actual experience is typing a total into
 * a form and trusting the split it shows them. This walks that path — post a
 * month's maintenance, see the preview, check it lands on a unit's ledger, then
 * record a payment against it and watch the balance move.
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

/**
 * A due date the seed never uses, distinct per run, and in the past.
 *
 * Past matters: the aging arithmetic only counts charges that have come due, so
 * a future-dated run would post correctly and leave every balance at zero,
 * making the payment assertion below meaningless. Distinct matters because
 * posting the same month twice is refused by design.
 */
function unusedDueDate(): string {
  const month = (Date.now() % 12) + 1;
  const day = (Math.floor(Date.now() / 1000) % 28) + 1;
  return `2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

test("the treasurer posts a month's maintenance and records a payment", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";

  await signIn(page, TREASURER, base);
  await page.goto("/b/adelaide/arrears");
  await expect(page.getByRole("heading", { name: /up to date|behind/ })).toBeVisible();

  // ---- Post the month -----------------------------------------------------
  await page.getByRole("button", { name: "Post monthly maintenance" }).click();
  await page.getByLabel("Total to collect").fill("12,000.00");
  await page.getByLabel("Due date").fill(unusedDueDate());

  // The preview is the safeguard: it must appear before anything is posted,
  // and it must add up to what was typed.
  const preview = page.locator("li", { hasText: "shares" });
  await expect(preview.first()).toBeVisible();

  const amounts = await preview.allTextContents();
  const summed = amounts
    .map((row) =>
      Number((/([\d,]+\.\d{2})\s*$/.exec(row)?.[1] ?? "0").replace(/,/g, "")),
    )
    .reduce((total, n) => total + n, 0);
  expect(summed, "the previewed split must add up to the total").toBeCloseTo(12000, 2);

  await page.getByRole("button", { name: /^Post to \d+ apartments$/ }).click();
  await expect(page.getByText(/posted across \d+ apartments/)).toBeVisible();

  // ---- It shows up on a unit's ledger -------------------------------------
  await page.locator("table a[href*='/arrears/']").first().click();
  await page.waitForURL(/\/arrears\/[0-9a-f-]{36}/);
  await expect(page.getByText("Maintenance").first()).toBeVisible();

  const owedBefore = await outstanding(page);

  // ---- Record a payment against it ----------------------------------------
  await page.getByRole("button", { name: "Record a payment" }).click();
  await page.getByLabel("Amount").fill("100.00");
  await page.getByRole("button", { name: "Record the payment" }).click();

  await expect(page.getByText("Payment").first()).toBeVisible();
  await expect
    .poll(async () => outstanding(page), {
      message: "recording a payment should reduce what the apartment owes",
    })
    .toBeLessThan(owedBefore);
});

/** What the unit page says is outstanding, in dollars. */
async function outstanding(page: Page): Promise<number> {
  const lede = await page.locator("header p").last().textContent();
  const match = /\$([\d,]+\.\d{2})/.exec(lede ?? "");
  return match?.[1] ? Number(match[1].replace(/,/g, "")) : 0;
}
