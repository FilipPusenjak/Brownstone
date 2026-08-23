import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * A repair, driven through a browser from both sides.
 *
 * The claim being tested is the one that protects a shareholder: nobody can put
 * a repair on my ledger until the board has said in writing that it is mine to
 * pay for. That refusal is checked against the real interface, because a rule
 * enforced in the write path but bypassable through a stale page is not a rule.
 *
 * The second run checks the other half — that a repair inside my apartment is
 * not readable by the neighbour across the hall.
 */

const MAIL_DIR = ".mail";
const PRESIDENT = "nora.whitfield@example.com";
const TREASURER = "desmond.achebe@example.com";
/** Holds the garden apartment. */
const SHAREHOLDER = "hal.brenner@example.com";
/** Holds 2R, and has no business reading the garden apartment's repairs. */
const NEIGHBOUR = "marta.oyelaran@example.com";

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

test("a repair cannot be billed until the board says who pays", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  const title = `Kitchen tap seized ${Date.now().toString(36)}`;

  // ---- The shareholder reports it -----------------------------------------
  await signIn(page, SHAREHOLDER, base);
  await page.goto("/b/adelaide/tickets");
  await page.getByRole("button", { name: "Report a repair" }).click();
  await page.getByLabel("What's wrong").fill(title);
  await page.getByLabel("Where", { exact: true }).selectOption({ label: "GARDEN" });
  await page
    .getByLabel("Describe it")
    .fill("The cold tap will not turn. It has been getting stiffer for a month.");
  await page.getByRole("button", { name: "Report it" }).click();

  await page.waitForURL(/\/tickets\/[0-9a-f-]{36}/);
  const ticketUrl = page.url();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Not decided")).toBeVisible();

  // A shareholder gets no triage controls and no bill button.
  await expect(page.getByLabel("Where it's up to")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Bill / })).toHaveCount(0);

  // ---- They ask the board ---------------------------------------------------
  await page.getByRole("button", { name: "Ask the board who pays" }).click();
  await page
    .getByLabel("Why you're asking")
    .fill("The tap came with the apartment, so I am not sure this one is mine.");
  await page.getByRole("button", { name: "Put it to the board" }).click();
  await expect(page.getByText(/Not decided yet/)).toBeVisible();

  // ---- The treasurer cannot bill it yet -------------------------------------
  await signIn(page, TREASURER, base);
  await page.goto(ticketUrl);
  await expect(
    page.getByText(/Nothing can be billed until the board has recorded who pays/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Bill / })).toHaveCount(0);

  // ---- The president decides ------------------------------------------------
  await signIn(page, PRESIDENT, base);
  await page.goto(ticketUrl);
  await page.getByRole("button", { name: "Record who pays" }).click();
  await page.getByLabel("Who pays").selectOption("SHAREHOLDER");
  await page
    .getByLabel("On what basis")
    .fill("Fixture inside the apartment. Paragraph 18 of the proprietary lease.");
  await page.getByRole("button", { name: "Record it" }).click();

  // The chip in the "Who pays" heading, not one of the hidden options in the
  // assignee dropdown.
  await expect(page.getByRole("heading", { name: /Who pays/ })).toContainText(
    "Shareholder",
  );
  await expect(page.getByText(/Paragraph 18/)).toBeVisible();

  // Decided once, and not again — the record is the record.
  await expect(page.getByRole("button", { name: "Record who pays" })).toHaveCount(0);

  // The president can decide who pays but cannot put it on a ledger.
  await expect(
    page.getByText(/Only the treasurer can put it on a ledger/),
  ).toBeVisible();

  // ---- Now the treasurer can, and it asks twice -----------------------------
  await signIn(page, TREASURER, base);
  await page.goto(ticketUrl);
  await page.getByRole("button", { name: "Bill GARDEN for this" }).click();
  await page.getByLabel("Amount").fill("285.00");
  await page.getByRole("button", { name: "Bill it" }).click();
  // The rendered copy uses a typographic apostrophe, so match loosely.
  await expect(page.getByText(/puts 285\.00 on GARDEN.s ledger/)).toBeVisible();
  await page.getByRole("button", { name: "Yes, bill GARDEN" }).click();

  await expect(page.getByText(/on GARDEN.s ledger, due/)).toBeVisible();
  // Once only.
  await expect(page.getByRole("button", { name: /^Bill GARDEN/ })).toHaveCount(0);

  // ---- And it is real money on a real ledger --------------------------------
  await page.goto("/b/adelaide/arrears");
  await page.locator("table a[href*='/arrears/']").first().click();
  await page.waitForURL(/\/arrears\/[0-9a-f-]{36}/);
});

test("a repair inside an apartment is not the neighbour's business", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  const title = `Bedroom window jammed ${Date.now().toString(36)}`;

  await signIn(page, SHAREHOLDER, base);
  await page.goto("/b/adelaide/tickets");
  await page.getByRole("button", { name: "Report a repair" }).click();
  await page.getByLabel("What's wrong").fill(title);
  await page.getByLabel("Where", { exact: true }).selectOption({ label: "GARDEN" });
  await page
    .getByLabel("Describe it")
    .fill("The sash will not lift more than an inch since the cold snap.");
  await page.getByRole("button", { name: "Report it" }).click();
  await page.waitForURL(/\/tickets\/[0-9a-f-]{36}/);
  const ticketUrl = page.url();

  // Marta holds 2R. This is none of her business — not in the list, and not by
  // typing the address either.
  await signIn(page, NEIGHBOUR, base);
  await page.goto("/b/adelaide/tickets");
  await expect(page.getByText(title)).toHaveCount(0);

  const response = await page.goto(ticketUrl);
  expect(response?.status()).toBe(404);

  // The shared one, though, everyone can see.
  await page.goto("/b/adelaide/tickets");
  await expect(page.getByText("Front door latch not catching")).toBeVisible();
});
