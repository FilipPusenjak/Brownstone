import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

/**
 * The one path that has to work.
 *
 * A board member invites a neighbour, the neighbour joins, opens the compliance
 * calendar and closes out a filing. If that works, the product's spine works:
 * auth, invitation redemption, tenant scoping, capabilities, a Server Action
 * that writes, and the derived status that comes back.
 *
 * It runs against a real build, a real Postgres and real email — the catcher
 * driver writes `.eml` files to `./.mail`, and this test reads the links out of
 * them exactly as a person would read them out of their inbox. Nothing here
 * reaches into the database to fake a session.
 *
 * The board member signs in by emailed link and the neighbour makes an account
 * from the invitation, which is both ways in exercised in one run.
 */

const MAIL_DIR = ".mail";

/** A fresh address per run, so the run is repeatable against a seeded database. */
const joinerEmail = `sofia.reyes.${Date.now().toString(36)}@example.com`;
const joinerPassword = "cornice-parapet-transom-41";

interface Mail {
  readonly body: string;
  readonly at: number;
}

function mailFor(recipient: string, since: number): Mail[] {
  if (!existsSync(MAIL_DIR)) return [];

  return readdirSync(MAIL_DIR)
    .filter((name) => name.endsWith(".eml"))
    .map((name) => {
      const path = join(MAIL_DIR, name);
      return { body: readFileSync(path, "utf8"), at: statSync(path).mtimeMs };
    })
    .filter(
      (mail) =>
        mail.at >= since && mail.body.includes(`To: ${recipient.toLowerCase()}`),
    )
    .sort((a, b) => b.at - a.at);
}

/**
 * Waits for a link to turn up in the recipient's mail.
 *
 * Polling rather than a fixed sleep: the send happens inside the request the
 * browser just made, so it is usually there immediately, and a sleep would
 * either be flaky or slow.
 */
async function waitForLink(
  recipient: string,
  pattern: RegExp,
  since: number,
): Promise<string> {
  const deadline = Date.now() + 15_000;

  while (Date.now() < deadline) {
    for (const mail of mailFor(recipient, since)) {
      const match = pattern.exec(mail.body);
      if (match?.[0]) return match[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  throw new Error(`No mail matching ${pattern} arrived for ${recipient}`);
}

/**
 * Whether something turns up, without failing the test if it doesn't.
 *
 * `isVisible()` answers instantly and would report "no" for anything still
 * rendering — which, in a loop over pages, silently means "nothing here" every
 * time. This waits, briefly, and then answers.
 */
async function appears(locator: Locator, timeout = 3_000): Promise<boolean> {
  return locator.waitFor({ state: "visible", timeout }).then(
    () => true,
    () => false,
  );
}

/** The app may be reached on a different host than AUTH_URL names. */
function onBaseUrl(link: string, baseURL: string): string {
  const url = new URL(link);
  const base = new URL(baseURL);
  url.protocol = base.protocol;
  url.host = base.host;
  return url.toString();
}

/**
 * Signs in the way a person does: ask for a link, open the link.
 *
 * `from` matters. An invited neighbour is sent to `/sign-in?invite=…`, and that
 * parameter is what brings them back to the invitation afterwards instead of to
 * a building list they are not yet a member of.
 */
async function signIn(
  page: Page,
  email: string,
  baseURL: string,
  from = "/sign-in",
): Promise<void> {
  const since = Date.now() - 1000;

  await page.goto(from);
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Email me a link" }).click();

  const link = await waitForLink(
    email,
    /https?:\/\/[^\s"]+\/api\/auth\/callback\/email\?[^\s"<]+/,
    since,
  );

  // `commit` rather than `load`: the callback is a 302 into a second redirect,
  // and waiting for the load event of a response that is immediately replaced
  // reports the navigation as aborted. What matters is where it lands, which
  // the caller then asserts.
  await page.goto(onBaseUrl(link, baseURL), { waitUntil: "commit" });
  await page.waitForLoadState("domcontentloaded");
}

test.describe("a neighbour joins and files something", () => {
  let board: BrowserContext;
  let joiner: BrowserContext;

  test.afterAll(async () => {
    await board?.close();
    await joiner?.close();
  });

  test("invite, accept, open the calendar, close out a filing", async ({
    browser,
    baseURL,
  }) => {
    test.slow();
    const base = baseURL ?? "http://127.0.0.1:3000";

    // ---- The board sends the invitation -------------------------------------
    board = await browser.newContext();
    const president = await board.newPage();

    await signIn(president, "nora.whitfield@example.com", base);
    await expect(president).toHaveURL(new RegExp("/b/|/$"));

    const invitedAt = Date.now() - 1000;
    await president.goto("/b/adelaide/members");
    await expect(
      president.getByRole("heading", { name: /people have access/ }),
    ).toBeVisible();

    await president.getByRole("button", { name: "Invite a neighbour" }).click();
    await president.getByLabel("Email address").fill(joinerEmail);
    // An officer, so the joiner can close out a filing at the end of this test.
    await president.getByLabel("Also an officer?").selectOption("BOARD_MEMBER");
    await president.getByRole("button", { name: "Send the invitation" }).click();

    await expect(
      president.getByText(`Invitation sent to ${joinerEmail}`),
    ).toBeVisible();
    // The board can see what it left open.
    await expect(president.getByText(joinerEmail).first()).toBeVisible();

    // ---- The neighbour opens it ---------------------------------------------
    const inviteLink = await waitForLink(
      joinerEmail,
      /https?:\/\/[^\s"]+\/invite\/[A-Za-z0-9_-]+/,
      invitedAt,
    );

    joiner = await browser.newContext();
    const neighbour = await joiner.newPage();

    // The link is the whole of sign-up: a name, a password, and they are in.
    // The address is not a field, because the invitation already names it —
    // holding the link is what proves it is theirs.
    await neighbour.goto(onBaseUrl(inviteLink, base));
    await expect(
      neighbour.getByRole("heading", { name: "Join The Adelaide" }),
    ).toBeVisible();
    await expect(neighbour.getByLabel("Email address")).toHaveValue(joinerEmail);

    // Nothing is redeemed by loading the page — a mail client that prefetches
    // the link must not consume the invitation before anyone sees it.
    await neighbour.getByLabel("Your name").fill("A New Neighbour");
    await neighbour.getByLabel("Choose a password").fill(joinerPassword);
    await neighbour.getByLabel("And again").fill(joinerPassword);
    await neighbour
      .getByRole("button", { name: /^Create the account and join/ })
      .click();

    await expect(neighbour).toHaveURL(/\/b\/adelaide$/);

    // ---- …and does something with it ----------------------------------------
    await neighbour.goto("/b/adelaide/compliance");
    await expect(
      neighbour.getByRole("heading", { name: "What this building owes the city" }),
    ).toBeVisible();

    // Nothing reaches the calendar without a board member confirming it
    // applies, so on a freshly seeded building the first act is that decision.
    await putSomethingOnTheCalendar(neighbour);

    const filed = await closeOutAFiling(neighbour);
    expect(filed, "no open obligation was available to file").toBe(true);

    // The other building is a 404, not a 403 — a stranger must not be able to
    // confirm a co-op exists at a slug by reading the status code.
    const elsewhere = await neighbour.goto("/b/lispenard-house/compliance");
    expect(elsewhere?.status()).toBe(404);
    await expect(
      neighbour.getByRole("heading", { name: "Nothing here" }),
    ).toBeVisible();
  });
});

/**
 * Confirms a proposed requirement, if the calendar is empty.
 *
 * Requirements are never auto-added: the ruleset proposes, and a board member
 * decides whether it applies to this building. That decision is the only way a
 * row reaches the calendar, so a smoke test on a fresh building has to make it.
 */
async function putSomethingOnTheCalendar(page: Page): Promise<void> {
  if ((await page.locator("table a[href*='/compliance/']").count()) > 0) return;

  await page.getByRole("button", { name: "Add to the calendar" }).first().click();

  // Some rules cannot name a date on their own — a boiler inspection depends on
  // when the last one happened — and ask the board to supply one.
  const card = page
    .locator("li")
    .filter({ has: page.locator("input[type=date]") })
    .first();
  if (await appears(card)) {
    await card.getByRole("button", { name: "Add to the calendar" }).click();
  }

  await expect(page.locator("table a[href*='/compliance/']").first()).toBeVisible();
}

/**
 * Opens obligations in turn until one is still open, and files it.
 *
 * Which rows are open depends on today's date and on whatever earlier runs
 * closed, so the test finds its own work rather than assuming a row.
 */
async function closeOutAFiling(page: Page): Promise<boolean> {
  const links = page.locator("table a[href*='/compliance/']");
  const count = Math.min(await links.count(), 8);

  for (let index = 0; index < count; index += 1) {
    await page.goto("/b/adelaide/compliance");
    const link = page.locator("table a[href*='/compliance/']").nth(index);
    const title = (await link.textContent())?.trim() ?? "";
    await link.click();
    await page.waitForURL(/\/compliance\/[0-9a-f-]{36}/);

    // Already filed, or waived: this one offers "Reopen" instead.
    const open = page.getByRole("button", { name: "Mark it filed" }).first();
    if (!(await appears(open))) continue;

    await open.click();
    await page.getByLabel("Note").fill("Filed during the smoke test.");
    // The idle row is gone in this mode, so the name is unambiguous — and the
    // action keeps its name from the first click to the last.
    await page.getByRole("button", { name: "Mark it filed" }).click();

    // "Filed." — and, for anything recurring, when the next one is due.
    await expect(page.getByText(/^Filed\./)).toBeVisible();
    expect(title.length).toBeGreaterThan(0);
    return true;
  }

  return false;
}
