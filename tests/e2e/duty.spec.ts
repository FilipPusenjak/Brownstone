import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The rota, and the summons that arrives after it.
 *
 * The run below is the module's whole argument in one sequence: two neighbours
 * swap a week, a summons is logged with only its date, and the building names
 * the apartment that actually took the turn — not the one the rotation would
 * have picked. Nobody types a name anywhere in that.
 */

const MAIL_DIR = ".mail";
const PRESIDENT = "nora.whitfield@example.com";
const TREASURER = "desmond.achebe@example.com";
const SHAREHOLDER = "hal.brenner@example.com";

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

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

test("a summons names whoever actually had the week, swap included", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  const ticket = `E2E-${Date.now().toString(36)}`;

  await signIn(page, PRESIDENT, base);
  await page.goto("/b/adelaide/duty");

  // The seeded rota already runs either side of today.
  await expect(page.getByText("Trash and recycling set-out")).toBeVisible();
  await expect(page.getByText(/Rota runs to/)).toBeVisible();

  // ---- Swap two upcoming weeks --------------------------------------------
  await page.getByRole("button", { name: "Swap two turns" }).click();

  // Read the two apartments out of the pickers so the assertion below does not
  // depend on which day of the week the suite happens to run on.
  const first = page.getByLabel("This turn");
  const second = page.getByLabel("Trades with");
  const options = await first.locator("option").allTextContents();
  expect(options.length).toBeGreaterThan(2);

  await first.selectOption({ index: 0 });
  await second.selectOption({ index: 1 });

  // Before the swap, the first week belongs to one apartment and the second to
  // another. Afterwards they trade, so a summons dated in the first week must
  // name the second apartment.
  const weekOf = options[0]!.split(" · ")[1]!;
  const wouldHaveBeen = options[0]!.split(" · ")[0]!;
  const takenBy = options[1]!.split(" · ")[0]!;
  expect(takenBy).not.toEqual(wouldHaveBeen);

  await page.getByRole("button", { name: "Swap them" }).click();
  await expect(page.getByRole("button", { name: "Swap two turns" })).toBeVisible();

  // ---- Log a summons dated inside the swapped week ------------------------
  // The form asks for a date and never for an apartment.
  await page.getByRole("button", { name: "Log a summons" }).click();
  await expect(page.getByLabel("Summons number")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /apartment/i })).toHaveCount(0);

  await page.getByLabel("Summons number").fill(ticket);
  await page.getByLabel("Issued").fill(isoDaysFromNow(2));
  await page.getByLabel("Amount").fill("100.00");
  await page.getByLabel("Answer by").fill(isoDaysFromNow(32));
  await page.getByLabel("Violation").fill("Receptacle set out before 6pm");
  await page.getByRole("button", { name: "Log it" }).click();

  await expect(page.getByText(ticket)).toBeVisible();

  // ---- And it names the neighbour who took the turn -----------------------
  await page
    .getByRole("link", { name: "Receptacle set out before 6pm" })
    .first()
    .click();
  await page.waitForURL(/\/duty\/fines\/[0-9a-f-]{36}/);

  // Scoped to the section, because apartment labels and dates both recur
  // elsewhere on the page.
  const whose = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Whose week it was" }) });
  await expect(whose).toBeVisible();

  // The turn the date fell in.
  await expect(whose.getByText(/^turn ran /)).toContainText(
    new RegExp(weekOf.replace(/\s+/g, "\\s+")),
  );

  // And it names the neighbour who took the week, not the one the rotation
  // would have picked. Nobody typed either name.
  await expect(whose).toContainText(takenBy);
  await expect(whose).not.toContainText(new RegExp(`^${wouldHaveBeen}$`, "m"));

  // ---- The answer-by date is on the calendar ------------------------------
  await expect(
    page.getByText(/Missing the window is how a contestable fine/),
  ).toBeVisible();

  await page.goto("/b/adelaide/compliance");
  await expect(
    page.getByText(new RegExp(`Answer sanitation summons ${ticket}`)),
  ).toBeVisible();
});

test("a summons the rota does not cover has nobody to bill", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  const ticket = `E2E-OLD-${Date.now().toString(36)}`;

  await signIn(page, PRESIDENT, base);
  await page.goto("/b/adelaide/duty");

  // Dated years before any rota in the seed.
  await page.getByRole("button", { name: "Log a summons" }).click();
  await page.getByLabel("Summons number").fill(ticket);
  await page.getByLabel("Issued").fill("2009-05-04");
  await page.getByLabel("Amount").fill("50.00");
  await page.getByLabel("Violation").fill("Failure to recycle");
  await page.getByRole("button", { name: "Log it" }).click();

  await page.getByRole("link", { name: "Failure to recycle" }).first().click();
  await page.waitForURL(/\/duty\/fines\/[0-9a-f-]{36}/);

  await expect(page.getByText(/is not attributed to any apartment/)).toBeVisible();

  // Even the treasurer has nothing to charge — picking somebody after the fact
  // would be a guess with a bill attached.
  const fineUrl = page.url();
  await signIn(page, TREASURER, base);
  await page.goto(fineUrl);
  await expect(
    page.getByText(/there is nobody the bill honestly belongs to/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Recharge it/ })).toHaveCount(0);
});

test("a shareholder sees the rota and cannot run it", async ({ page, baseURL }) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";

  await signIn(page, SHAREHOLDER, base);
  await page.goto("/b/adelaide/duty");

  // Whose week it is is everybody's business.
  await expect(page.getByText("Trash and recycling set-out")).toBeVisible();
  await expect(page.getByText("This week")).toBeVisible();

  // Running it is not.
  await expect(page.getByRole("button", { name: "Set up a rotation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Log a summons" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Extend the rota" })).toHaveCount(0);

  // But swapping their own week is — that is the sociable half of the feature.
  await expect(page.getByRole("button", { name: "Swap two turns" })).toBeVisible();
});
