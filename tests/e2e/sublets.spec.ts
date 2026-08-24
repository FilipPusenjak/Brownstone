import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The sublet cap, driven through a browser.
 *
 * The Adelaide is six apartments at a twenty per cent cap, so exactly one may
 * be sublet at a time — which makes the second application the interesting one.
 * The run below approves the first and watches the board be refused the second,
 * then records the first ending early and watches the same refusal turn into an
 * approval without anything else changing.
 *
 * That last step is the point. The cap is not a property of an application, it
 * is a property of the building on a given day, and the only way to be sure the
 * page and the write path agree about it is to move the day underneath them.
 */

const MAIL_DIR = ".mail";
const PRESIDENT = "nora.whitfield@example.com";
const TREASURER = "desmond.achebe@example.com";
/** Holds the garden apartment. */
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

/**
 * A term window unique to this run.
 *
 * These tests write real sublets, and a fixed year would collide with the
 * previous run's rows — the overlap check would refuse the application and the
 * failure would look like a bug in the cap rather than in the fixture. Derived
 * from the clock rather than random so a single run is self-consistent and
 * reproducible from its own output.
 */
function windowFor(offset = 0): {
  year: number;
  start: string;
  end: string;
} {
  const year = 2100 + ((Math.floor(Date.now() / 1000) + offset * 7) % 700);
  return { year, start: `${year}-04-01`, end: `${year + 1}-03-31` };
}

/** Files an application for the signed-in member's own apartment. */
async function apply(
  page: Page,
  buildingSlug: string,
  subtenant: string,
  start: string,
  end: string,
): Promise<string> {
  await page.goto(`/b/${buildingSlug}/sublets`);
  await page.getByRole("button", { name: "Apply to sublet" }).click();
  await page.getByLabel("Who is moving in").fill(subtenant);
  await page.getByLabel("Term starts").fill(start);
  await page.getByLabel("Term ends").fill(end);
  await page.getByLabel("Sublet fee").fill("1,200.00");
  await page.getByRole("button", { name: "Apply", exact: true }).click();

  await page.waitForURL(/\/sublets\/[0-9a-f-]{36}/);
  return page.url();
}

test("the board is refused a sublet that would breach the cap, until a slot frees", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  const tag = Date.now().toString(36);

  const { year, start: START, end: END } = windowFor();

  // ---- The garden apartment applies ---------------------------------------
  await signIn(page, SHAREHOLDER, base);
  const first = await apply(page, "adelaide", `Delphine ${tag}`, START, END);
  await expect(page.getByText("Waiting")).toBeVisible();

  // ---- The president approves it ------------------------------------------
  await signIn(page, PRESIDENT, base);
  await page.goto(first);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved").first()).toBeVisible();

  // The end of the term went onto the compliance calendar.
  await expect(page.getByText(/on the compliance calendar/)).toBeVisible();

  // ---- A second apartment applies for the same window ---------------------
  // Filed by the president on 2R's behalf, which officers may do.
  await page.goto("/b/adelaide/sublets");
  await page.getByRole("button", { name: "Apply to sublet" }).click();
  await page.getByLabel("Apartment", { exact: true }).selectOption({ label: "2R" });
  await page.getByLabel("Who is moving in").fill(`Tomas ${tag}`);
  await page.getByLabel("Term starts").fill(START);
  await page.getByLabel("Term ends").fill(END);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForURL(/\/sublets\/[0-9a-f-]{36}/);
  const second = page.url();

  // ---- The page warns before the button is pressed ------------------------
  await expect(
    page.getByText(/Approving this would put the building over its cap/),
  ).toBeVisible();

  // ---- And the write path refuses it anyway -------------------------------
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText(/would put the building over its cap/)).toBeVisible();
  // Still waiting, not half-approved.
  await expect(page.getByText("Waiting")).toBeVisible();

  // ---- The first subtenant leaves early -----------------------------------
  await page.goto(first);
  await page.getByRole("button", { name: "Record that it ended early" }).click();
  await page.getByLabel("Last day").fill(`${year}-06-01`);
  await page.getByLabel("Why").fill("Took a job out of state.");
  await page.getByRole("button", { name: "Record it" }).click();
  await expect(page.getByText(/Ended early on/)).toBeVisible();

  // ---- Which frees the slot, for a term starting after that day ------------
  // The second application starts 1 April, still inside the first term, so it
  // is still refused — the cap is read as of the day the subtenant moves in.
  await page.goto(second);
  await expect(
    page.getByText(/Approving this would put the building over its cap/),
  ).toBeVisible();

  // A later term is fine.
  await page.goto("/b/adelaide/sublets");
  await page.getByRole("button", { name: "Apply to sublet" }).click();
  await page.getByLabel("Apartment", { exact: true }).selectOption({ label: "4F" });
  await page.getByLabel("Who is moving in").fill(`Priyanka ${tag}`);
  await page.getByLabel("Term starts").fill(`${year}-08-01`);
  await page.getByLabel("Term ends").fill(`${year + 1}-07-31`);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForURL(/\/sublets\/[0-9a-f-]{36}/);

  await expect(
    page.getByText(/Approving this would put the building over its cap/),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved").first()).toBeVisible();
});

test("the fee reaches the ledger, and only after approval", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  const tag = Date.now().toString(36);

  await signIn(page, SHAREHOLDER, base);
  const { start, end } = windowFor(1);
  const url = await apply(page, "adelaide", `Subtenant ${tag}`, start, end);

  // ---- Before approval, the treasurer has nothing to charge ---------------
  await signIn(page, TREASURER, base);
  await page.goto(url);
  await expect(
    page.getByText(/Nothing can be charged until the board has approved/),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Charge the fee/ })).toHaveCount(0);

  // ---- After it, they can ---------------------------------------------------
  await signIn(page, PRESIDENT, base);
  await page.goto(url);
  await page.getByRole("button", { name: "Approve", exact: true }).click();
  await expect(page.getByText("Approved").first()).toBeVisible();
  // The president decides, the treasurer bills.
  await expect(
    page.getByText(/Only the treasurer can put it on a ledger/),
  ).toBeVisible();

  await signIn(page, TREASURER, base);
  await page.goto(url);
  await page.getByRole("button", { name: "Charge the fee to GARDEN" }).click();
  await page.getByRole("button", { name: "Charge GARDEN" }).click();

  await expect(page.getByText(/on GARDEN.s ledger, due/)).toBeVisible();
  // Once only.
  await expect(page.getByRole("button", { name: /^Charge the fee/ })).toHaveCount(0);
});

test("a shareholder cannot read a neighbour's application", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  const tag = Date.now().toString(36);

  await signIn(page, SHAREHOLDER, base);
  const { start, end } = windowFor(2);
  const url = await apply(page, "adelaide", `Private ${tag}`, start, end);

  // Marta holds 2R.
  await signIn(page, "marta.oyelaran@example.com", base);
  const response = await page.goto(url);
  expect(response?.status()).toBe(404);

  // But the cap reading is public, because it governs whether she may apply.
  await page.goto("/b/adelaide/sublets");
  await expect(page.getByText(/the lease allows 1 \(20%\)/)).toBeVisible();
});
