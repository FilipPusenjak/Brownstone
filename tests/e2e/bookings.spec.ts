import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * A move, and what it takes to confirm one.
 *
 * The Adelaide is a six-unit 1899 brownstone with no lift, so what it schedules
 * is the stoop and the hallway — which is the point: the module knows about
 * slots and conditions, not about elevators.
 *
 * The run below is the module's argument end to end. The board tries to
 * confirm a move and is told, in one go, that the deposit is missing and that
 * the mover's certificate — current today — lapses before the truck arrives.
 * That second sentence is the whole module: a check read against the day of
 * the request would have waved it through, and the building would have found
 * out at the door. Then it confirms the booking where both conditions hold,
 * and the page shows what was checked and when.
 *
 * The second test is the calendar's one hard rule: a slot somebody holds
 * cannot be taken, and the refusal names who has it.
 *
 * The third is the claim the prerequisite registry was built to make good on —
 * the roof deck arrives as a row, with its own hours and its own conditions,
 * and nothing about the checking changes to accommodate it.
 */

const MAIL_DIR = ".mail";
const PRESIDENT = "nora.whitfield@example.com";
const SHAREHOLDER = "hal.brenner@example.com";
const NEIGHBOUR = "marta.oyelaran@example.com";

/**
 * What The Adelaide schedules. Named explicitly rather than taken as the
 * default, because the page lists resources alphabetically and a run that adds
 * a roof deck would otherwise change which one every later test books.
 */
const MOVES = "Stoop and hallway (moves)";

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

/** The day a booking `days` from now falls on, as the calendar's date param. */
function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Takes the first free slot on a day for one apartment, landing on its page.
 *
 * The board can book for any apartment, which is what lets one signed-in
 * session set up both halves of the run below.
 */
async function hold(page: Page, date: string, unitLabel: string): Promise<void> {
  await page.goto(`/b/adelaide/bookings?date=${date}`);
  await page.getByRole("link", { name: MOVES, exact: true }).click();
  await page.getByRole("button", { name: "Ask for a slot" }).click();
  await page.getByLabel("Which slot").selectOption({ index: 1 });
  await page
    .getByLabel("Apartment", { exact: true })
    .selectOption({ label: unitLabel });
  await page.getByRole("button", { name: "Hold it" }).click();
  await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
}

test("a move is refused until the deposit and the certificate are both in order", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";

  // Two fresh days rather than the seeded bookings: this run records a deposit
  // and confirms, and a second run against the same database would find that
  // work already done. Far enough out to be past the mover's certificate,
  // close enough to be inside the contractor's.
  const jitter = Date.now() % 50;
  const blocked = isoDaysFromNow(20 + jitter);
  const clear = isoDaysFromNow(21 + jitter);

  await signIn(page, PRESIDENT, base);

  // ---- The one with nothing in order --------------------------------------
  // The garden apartment's mover is insured today and lapses in five days,
  // before the move. Nothing has been recorded against the deposit.
  await hold(page, blocked, "GARDEN");

  await expect(page.getByText(/Holding the slot/)).toBeVisible();
  // The conditions are read against the day of the move, and the page says so.
  await expect(page.getByText(/not against today/)).toBeVisible();

  await page.getByRole("button", { name: "Check and confirm" }).click();

  // Both problems at once, rather than one at a time.
  const refusal = page.getByTestId("confirm-error");
  await expect(refusal).toContainText(/[Dd]eposit/);
  await expect(refusal).toContainText(/before this booking/);

  // And it is still held, not confirmed.
  await expect(page.getByText(/Holding the slot/)).toBeVisible();

  // What was checked is written down, failures included.
  await expect(page.getByText(/^checked /).first()).toBeVisible();

  // ---- Recording the deposit clears half of it ----------------------------
  await page.getByRole("button", { name: "Record the deposit" }).click();
  await page.getByLabel("Amount").fill("500");
  await page.getByLabel("Reference").fill("chq 5150");
  await page.getByRole("button", { name: "Record it" }).click();

  await expect(page.getByText(/chq 5150/)).toBeVisible();

  await page.getByRole("button", { name: "Check and confirm" }).click();
  // The deposit is no longer the problem. The lapsing certificate still is.
  const second = page.getByTestId("confirm-error");
  await expect(second).toContainText(/before this booking/);
  await expect(second).not.toContainText(/[Dd]eposit outstanding/);

  // ---- The one where everything holds -------------------------------------
  // 1F's contractor is insured to two million, named on the policy, and
  // current through the year.
  await hold(page, clear, "1F");

  await page.getByRole("button", { name: "Record the deposit" }).click();
  await page.getByLabel("Amount").fill("500");
  await page.getByLabel("Reference").fill("chq 5151");
  await page.getByRole("button", { name: "Record it" }).click();
  await expect(page.getByText(/chq 5151/)).toBeVisible();

  await page.getByRole("button", { name: "Check and confirm" }).click();
  await expect(page.getByText(/The slot is theirs/)).toBeVisible();
  await expect(page.getByTestId("confirm-error")).toHaveCount(0);
});

test("a slot somebody holds cannot be taken, and the next one along can", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  // A day far enough out that re-running the suite does not collide with a
  // slot a previous run took.
  const day = isoDaysFromNow(120 + (Date.now() % 90));

  await signIn(page, SHAREHOLDER, base);
  await page.goto(`/b/adelaide/bookings?date=${day}`);
  await page.getByRole("link", { name: MOVES, exact: true }).click();

  await page.getByRole("button", { name: "Ask for a slot" }).click();
  const slots = page.getByLabel("Which slot");
  const first = (await slots.locator("option").allTextContents())[1]!;

  await slots.selectOption({ index: 1 });
  await page.getByRole("button", { name: "Hold it" }).click();
  await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
  await expect(page.getByText(/Holding the slot/)).toBeVisible();

  // ---- A neighbour finds it gone ------------------------------------------
  await signIn(page, NEIGHBOUR, base);
  await page.goto(`/b/adelaide/bookings?date=${day}`);
  await page.getByRole("link", { name: MOVES, exact: true }).click();

  // The calendar shows it taken, and by whom — a calendar that hides its
  // bookings is not a calendar.
  await expect(page.getByText(first, { exact: false }).first()).toBeVisible();
  await expect(page.getByText("GARDEN").first()).toBeVisible();

  // And the slot is not on offer any more, so the next one along is what they
  // get instead.
  await page.getByRole("button", { name: "Ask for a slot" }).click();
  const offered = await page
    .getByLabel("Which slot")
    .locator("option")
    .allTextContents();
  expect(offered).not.toContain(first);
  expect(offered.length).toBeGreaterThan(1);

  await page.getByLabel("Which slot").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Hold it" }).click();
  await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);

  // ---- And they cannot read the neighbour's half of it --------------------
  await page.goto(`/b/adelaide/bookings?date=${day}`);
  await page.getByRole("link", { name: MOVES, exact: true }).click();
  await page
    .getByRole("link", { name: /GARDEN/ })
    .first()
    .click();
  await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);
  await expect(page.getByText(/is between GARDEN and the board/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Check and confirm" })).toHaveCount(0);
});

test("the roof deck arrives as a row, with its own hours and conditions", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  const name = `Roof deck ${Date.now().toString(36)}`;

  await signIn(page, PRESIDENT, base);
  await page.goto("/b/adelaide/bookings");

  await page.getByRole("button", { name: "Add something bookable" }).click();
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Kind").selectOption("ROOF_DECK");
  await page.getByLabel("Slot length").fill("3");
  await page.getByLabel("Opens").fill("10");
  await page.getByLabel("Closes").fill("22");

  // Its conditions come from the same registry the freight elevator uses.
  await page.getByLabel("Maintenance up to date").check();
  await page.getByRole("button", { name: "Add it" }).click();

  await expect(page.getByRole("link", { name })).toBeVisible();
  await page.getByRole("link", { name }).click();

  // Four three-hour slots between ten and ten, none of them the elevator's.
  await expect(page.getByText("10:00 AM – 1:00 PM")).toBeVisible();
  await expect(page.getByText("7:00 PM – 10:00 PM")).toBeVisible();
  await expect(page.getByText("Maintenance up to date")).toBeVisible();

  // And it books like anything else.
  await page.getByRole("button", { name: "Ask for a slot" }).click();
  await page.getByLabel("Which slot").selectOption({ index: 1 });
  await page.getByRole("button", { name: "Hold it" }).click();
  await page.waitForURL(/\/bookings\/[0-9a-f-]{36}/);

  await expect(page.getByText(/Holding the slot/)).toBeVisible();
  await expect(page.getByText("Maintenance up to date")).toBeVisible();

  // ---- And it comes off the list again ------------------------------------
  // Tidied up so a later run does not find a dozen roof decks, and because
  // retiring one has to leave what is already booked on it alone.
  await page.goto("/b/adelaide/bookings");
  await page.getByRole("link", { name, exact: true }).click();
  await page.getByRole("button", { name: `Take ${name} off the list` }).click();

  await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  // The booking somebody already made survives it.
  await expect(page.getByRole("link", { name: new RegExp(`${name} — `) })).toHaveCount(
    1,
  );
});
