import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * A meeting, run through a browser from the secretary's side.
 *
 * The thing being tested is the sequence a chair actually follows: call the
 * meeting, take the roster, confirm quorum, put the motion, record the vote,
 * write the minutes, adopt them. Two claims are checked along the way that
 * nothing but a real run can check — that the quorum meter moves as the roster
 * is ticked, and that the software refuses to record a vote at a meeting that
 * is short of quorum.
 */

const MAIL_DIR = ".mail";
const SECRETARY = "priya.raman@example.com";
/** Holds the garden apartment — 180 of The Adelaide's 1,200 shares. */
const SHAREHOLDER = "hal.brenner@example.com";

/** The seed calls one annual meeting this year and one last year. */
const THIS_YEAR = new Date().getFullYear();

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

/** Marks one apartment present through the roster select. */
async function markPresent(page: Page, label: string): Promise<void> {
  await page.getByLabel(`How ${label} is represented`).selectOption("IN_PERSON");
  // The server action re-renders the quorum meter; wait for the roster row to
  // settle rather than racing the next selection.
  await expect(page.getByLabel(`How ${label} is represented`)).toHaveValue("IN_PERSON");
}

test("a secretary takes the roster, is refused without quorum, then records the vote", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  const title = `Special meeting ${Date.now().toString(36)}`;

  await signIn(page, SECRETARY, base);

  // ---- Call the meeting ---------------------------------------------------
  await page.goto("/b/adelaide/meetings");
  await page.getByRole("button", { name: "Call a meeting" }).click();
  await page.getByLabel("What the meeting is").fill(title);
  await page.getByLabel("Kind").selectOption("SPECIAL");
  await page.getByLabel("Quorum under the bylaws").selectOption("two-thirds");
  await page.getByRole("button", { name: "Call it" }).click();

  await page.waitForURL(/\/meetings\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // ---- Nobody is here yet -------------------------------------------------
  // Two-thirds of The Adelaide's 1,200 shares is exactly 800.
  await expect(page.getByText("800 shares short")).toBeVisible();
  await expect(page.getByText(/Needs two-thirds/)).toBeVisible();

  // ---- The four smallest apartments turn up -------------------------------
  // A clear majority of the room — four of six — holding 700 of 1,200 shares.
  for (const label of ["2R", "4F", "GARDEN", "3R"]) {
    await markPresent(page, label);
  }
  await expect(page.getByText("100 shares short")).toBeVisible();

  // ---- And the software refuses to transact business ----------------------
  await page.getByRole("button", { name: "Record a resolution" }).click();
  await page.getByLabel("What was moved").fill("Repoint the rear facade");
  await page
    .getByLabel("The words put to the room")
    .fill("Resolved, that the corporation engage a mason to repoint the rear facade.");
  await page.getByLabel("How 3R voted").selectOption("FOR");
  await page.getByLabel("How 2R voted").selectOption("FOR");
  await page.getByRole("button", { name: "Record the vote" }).click();

  await expect(page.getByText(/100 shares short of quorum/)).toBeVisible();

  // ---- One more apartment arrives -----------------------------------------
  await markPresent(page, "1F");
  await expect(page.getByText("Met", { exact: true })).toBeVisible();

  // ---- Now the vote goes through ------------------------------------------
  await page.getByRole("button", { name: "Record the vote" }).click();
  await expect(page.getByRole("button", { name: "Record a resolution" })).toBeVisible();

  // 210 + 150 = 360 for, nothing against. Two apartments, 360 shares — the
  // tally is in shares, which is the whole point.
  await expect(page.getByText("360 for · 0 against · 0 abstaining")).toBeVisible();
  await expect(page.getByText("Carried", { exact: true })).toBeVisible();
  // 360 shares voted, a majority of them is 181, and the page shows the
  // arithmetic rather than only the verdict.
  await expect(page.getByText(/needed a majority of 360 shares = 181/)).toBeVisible();

  // ---- Minutes, then adoption ---------------------------------------------
  await page
    .getByLabel("Draft minutes")
    .fill(
      "The secretary called the meeting to order. Quorum was confirmed. The resolution to repoint the rear facade was put and carried.",
    );
  await page.getByRole("button", { name: "Adopt the minutes" }).click();
  await expect(page.getByText(/Adopting closes this meeting/)).toBeVisible();
  await page.getByRole("button", { name: "Yes, adopt them" }).click();

  await expect(page.getByText(/record is closed/)).toBeVisible();

  // Every control that could change the record is gone.
  await expect(page.getByRole("button", { name: "Record a resolution" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Draft minutes")).toHaveCount(0);
  await expect(page.getByLabel("How 1F is represented")).toHaveCount(0);

  // ---- And it reads back from the list ------------------------------------
  await page.goto("/b/adelaide/meetings");
  await expect(
    page.getByRole("row", { name: new RegExp(title) }).getByText("minutes adopted"),
  ).toBeVisible();
});

test("a shareholder gives their apartment's vote away, and takes it back", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";

  // A holder nobody else in the run will name, so re-runs against the same
  // database do not read each other's proxies.
  const holder = `Nora Whitfield ${Date.now().toString(36)}`;

  await signIn(page, SHAREHOLDER, base);

  // This year's annual meeting, which nobody has closed.
  await page.goto("/b/adelaide/meetings");
  await page
    .getByRole("link", { name: `${THIS_YEAR} annual shareholders meeting` })
    .click();
  await page.waitForURL(/\/meetings\/[0-9a-f-]{36}/);

  // A plain shareholder runs no meeting: the roster is read-only and there is
  // nothing here to record a resolution with.
  await expect(page.getByRole("button", { name: "Record a resolution" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("How 1F is represented")).toHaveCount(0);

  // ---- Give the garden apartment's vote to a neighbour --------------------
  await page.getByRole("button", { name: /Give GARDEN's vote to someone/ }).click();
  await page.getByLabel("Held by").fill(holder);
  await page.getByLabel("Evidence").fill("Signed proxy form");
  await page.getByRole("button", { name: "Record it" }).click();

  const row = page.getByRole("listitem").filter({ hasText: holder });
  await expect(row).toContainText(`GARDEN gives its vote to ${holder}`);
  // 180 shares now count toward quorum without Hal being in the room. Read off
  // the quorum meter itself, which states the whole reading in one label.
  await expect(
    page.getByRole("img", { name: /180 of 1,200 shares represented; 800 needed/ }),
  ).toBeVisible();

  // ---- And take it back ---------------------------------------------------
  await row.getByRole("button", { name: "Revoke" }).click();
  await expect(row).toContainText(`GARDEN gave its vote to ${holder}`);
  await expect(row).toContainText("revoked");
  await expect(
    page.getByRole("img", { name: /0 of 1,200 shares represented; 800 needed/ }),
  ).toBeVisible();
});

test("last year's adopted meeting reads as a closed record", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";

  await signIn(page, SHAREHOLDER, base);
  await page.goto("/b/adelaide/meetings");

  // The seeded meeting from last year: quorum met, one resolution carried,
  // minutes adopted. Named exactly, because the run above adopts minutes too.
  await page
    .getByRole("link", { name: `${THIS_YEAR - 1} annual shareholders meeting` })
    .click();
  await page.waitForURL(/\/meetings\/[0-9a-f-]{36}/);

  await expect(page.getByText(/record is closed/)).toBeVisible();
  await expect(page.getByText("Met", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Repoint the rear facade" }),
  ).toBeVisible();
  await expect(page.getByText("Carried", { exact: true })).toBeVisible();
  // One apartment voted through a proxy holder, and the record says which.
  await expect(page.getByText(/\(proxy\)/)).toBeVisible();

  // Nothing on this page can change it — not even for the person whose
  // apartment granted the proxy.
  await expect(page.getByRole("button", { name: "Revoke" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /vote to someone/ })).toHaveCount(0);
});
