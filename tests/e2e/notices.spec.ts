import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The annual notices, and what silence costs.
 *
 * The run below is the module's whole argument. A board sends the window guard
 * notice to every apartment, one household answers and the rest say nothing,
 * and closing the year out does not tidy the silent ones away — it puts each of
 * them on the compliance calendar to be inspected, because an apartment that
 * never replied is not an apartment that said no.
 *
 * The second test is the other half: a campaign cannot be closed while a
 * household still has time to answer, or while any apartment was never written
 * to at all.
 */

const MAIL_DIR = ".mail";
const PRESIDENT = "nora.whitfield@example.com";
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

/** Ninety-nine years to open campaigns in, starting somewhere random. */
const FIRST_YEAR = 2000;
const YEARS = 99;

/**
 * Opens a campaign in a year nothing has used yet.
 *
 * One campaign per notice type per year is the rule, and this suite opens real
 * ones against a database that keeps them, so a fixed year collides with a
 * previous run. The start is random rather than fixed so that repeated runs
 * spread out instead of walking further from the same place each time — a scan
 * that starts at the beginning gets one form submission slower every run, and
 * eventually starves the rest of the suite.
 */
async function openNotice(
  page: Page,
  noticeType: string,
  window: { dueOn: string; respondBy: string },
): Promise<void> {
  const start = Math.floor(Math.random() * YEARS);

  for (let attempt = 0; attempt < YEARS; attempt += 1) {
    const year = FIRST_YEAR + ((start + attempt) % YEARS);
    await page.goto("/b/adelaide/notices");
    await page.getByRole("button", { name: /^Open a notice for/ }).click();
    await page.getByLabel("Which notice").selectOption(noticeType);
    await page.getByLabel("Which year").fill(String(year));
    await page.getByLabel("Has to go out by").fill(window.dueOn);
    await page.getByLabel("Households reply by").fill(window.respondBy);
    await page.getByRole("button", { name: "Open it" }).click();

    const landed = await page
      .waitForURL(/\/notices\/[0-9a-f-]{36}/, { timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (landed) return;

    await expect(page.getByTestId("open-error")).toContainText(/already been opened/);
  }
  throw new Error("No free year left to open a notice in");
}

/** A campaign whose reply-by date is already in the past. */
const LATE = { dueOn: isoDaysFromNow(-60), respondBy: isoDaysFromNow(-30) };

test("silence becomes work on the calendar, not a no", async ({ page, baseURL }) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";

  await signIn(page, PRESIDENT, base);
  await openNotice(page, "WINDOW_GUARD", LATE);

  // Every apartment is listed before anything has gone out.
  await expect(page.getByRole("heading", { name: "Every apartment" })).toBeVisible();
  await expect(
    page.getByText("Nothing has gone to this apartment").first(),
  ).toBeVisible();

  // ---- Send it ------------------------------------------------------------
  await page.getByRole("button", { name: "Send it" }).click();
  await expect(page.getByTestId("send-summary")).toContainText(/Sent to \d+ household/);

  // What was sent is on the record, verbatim, with the address it went to.
  await expect(page.getByRole("heading", { name: "What was sent" })).toBeVisible();
  await expect(page.getByText(PRESIDENT).first()).toBeVisible();

  // ---- One household answers ---------------------------------------------
  await page.getByRole("button", { name: /Record GARDEN.s answer/ }).click();
  await page.getByLabel("They answered").selectOption("NO");
  await page.getByRole("button", { name: "Record it" }).click();

  // The button goes when the answer lands, which is what to wait on — the
  // answer's words also appear in the notice text further down the page.
  await expect(
    page.getByRole("button", { name: /Record GARDEN.s answer/ }),
  ).toHaveCount(0);
  await expect(
    page.getByText(/No child ten or younger lives here/).first(),
  ).toBeVisible();

  // ---- And the rest say nothing ------------------------------------------
  // The reply-by date has passed, so the five silent apartments are already
  // counted as work — before anybody presses anything.
  await expect(
    page.getByRole("heading", { name: /5 apartments to be seen to/ }),
  ).toBeVisible();
  await expect(page.getByText(/Never answered/).first()).toBeVisible();
  await expect(page.getByText("not booked yet").first()).toBeVisible();

  // ---- Closing it books the work -----------------------------------------
  await page.getByRole("button", { name: "Close it out" }).click();
  await expect(
    page.getByText(/This puts 5 apartments on the compliance calendar/),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close it and book the work" }).click();

  await expect(
    page.getByText(/What it left outstanding is on the compliance/),
  ).toBeVisible();
  await expect(page.getByText("on the calendar").first()).toBeVisible();
  await expect(page.getByText("not booked yet")).toHaveCount(0);

  // ---- And it is really on the calendar -----------------------------------
  await page.goto("/b/adelaide/compliance");
  await expect(
    page.getByText(/install window guards on every window/i).first(),
  ).toBeVisible();
});

test("a notice cannot be closed early, or around an apartment nobody wrote to", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";

  await signIn(page, PRESIDENT, base);

  // ---- Still inside the reply window --------------------------------------
  await openNotice(page, "LEAD_PAINT", {
    dueOn: isoDaysFromNow(-2),
    respondBy: isoDaysFromNow(28),
  });

  await page.getByRole("button", { name: "Send it" }).click();
  await expect(page.getByTestId("send-summary")).toBeVisible();

  // Nobody has answered, and nothing is owed — the households have time.
  await expect(
    page.getByRole("heading", { name: "Nothing outstanding" }),
  ).toBeVisible();
  // So there is nothing to close yet.
  await expect(page.getByRole("button", { name: "Close it out" })).toHaveCount(0);

  // ---- An apartment nobody wrote to ---------------------------------------
  await openNotice(page, "STOVE_KNOB_COVER", LATE);

  // Deliberately not sent. Every apartment is unwritten-to, so closing is
  // refused — an apartment nobody wrote to has neither answered nor ignored you.
  await page.getByRole("button", { name: "Close it out" }).click();
  await page.getByRole("button", { name: "Close it and book the work" }).click();
  await expect(page.getByTestId("close-error")).toContainText(
    /not been sent the notice/,
  );
});

test("a neighbour sees the count but not who has a child at home", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";

  await signIn(page, PRESIDENT, base);
  await openNotice(page, "WINDOW_GUARD", LATE);
  await page.getByRole("button", { name: "Send it" }).click();
  await expect(page.getByTestId("send-summary")).toBeVisible();

  await page.getByRole("button", { name: /Record 2R.s answer/ }).click();
  await page.getByLabel("They answered").selectOption("YES");
  await page.getByRole("button", { name: "Record it" }).click();
  await expect(page.getByRole("button", { name: /Record 2R.s answer/ })).toHaveCount(0);

  const url = page.url();

  // Hal holds the garden apartment and is nobody's officer.
  await signIn(page, SHAREHOLDER, base);
  await page.goto(url);

  // The standing is a compliance fact about the building, and his to see.
  await expect(page.getByRole("heading", { name: /to be seen to/ })).toBeVisible();
  await expect(page.getByText("2R").first()).toBeVisible();

  // What 2R actually said is not — and neither is the notice text, which
  // carries every apartment's address.
  await expect(page.getByText(/a child ten or younger lives here/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "What was sent" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Record 2R.s answer/ })).toHaveCount(0);

  // His own apartment is his to answer.
  await expect(
    page.getByRole("button", { name: /Record GARDEN.s answer/ }),
  ).toBeVisible();
});
