import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { Buffer } from "node:buffer";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Every module, reachable and working, from the navigation outward.
 *
 * The other specs each drive one module deeply. Nothing checked the plain
 * question underneath all of them: can a board member open every section of
 * this product and find something they can act on? A page that throws on a
 * building whose data happens to be shaped differently, or a module whose
 * detail view nobody has opened since it was written, fails that question
 * while every module-specific test still passes.
 *
 * So this walks the navigation the way a person does — read the links off the
 * shell, open each one, follow the first record into its detail view — and
 * asserts the same three things everywhere: the server did not error, the page
 * says what it is, and somebody with the capability for it can see the control
 * that does the work.
 *
 * It runs against both seeded buildings, because the two are deliberately
 * shaped differently: The Adelaide has no elevator and a 20% sublet cap,
 * Lispenard House has both. A page that only works on one of them is a page
 * that will not work on a co-op that just signed up.
 */

const MAIL_DIR = ".mail";

function isoDaysFromNow(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Presidents see the most, so a walk as one covers the most surface. */
const PRESIDENTS = {
  adelaide: "nora.whitfield@example.com",
  "lispenard-house": "ivan.petrosyan@example.com",
} as const;

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
 * Opens a path and insists the server actually served it.
 *
 * `next start` renders a thrown server error as a 500 with a generic body, and
 * a page that renders an error boundary still answers 200 — so both are
 * checked. The generic text is Next's, not this application's: Co-operator's
 * own refusals are specific, and one of them reaching this assertion would
 * mean a page had been given up on rather than written.
 */
async function open(page: Page, path: string): Promise<void> {
  const response = await page.goto(path);
  expect(response?.status(), `${path} answered ${response?.status()}`).toBeLessThan(
    400,
  );

  await expect(
    page.getByText(/Application error|a server-side exception|Internal Server Error/),
    `${path} rendered an error boundary`,
  ).toHaveCount(0);

  // Every page in the product has a heading naming it. A blank one is a page
  // that resolved but rendered nothing, which is the failure a status check
  // alone reads as success.
  await expect(page.locator("h1"), `${path} has no heading`).toHaveCount(1);
  await expect(page.locator("h1")).not.toBeEmpty();
}

for (const [slug, president] of Object.entries(PRESIDENTS)) {
  test(`every section of ${slug} opens, and its records open too`, async ({
    page,
    baseURL,
  }) => {
    test.slow();
    await signIn(page, president, baseURL ?? "http://localhost:3000");

    await open(page, `/b/${slug}`);

    // The navigation is the product's own list of what exists. Reading it here
    // rather than hard-coding paths means a module added later is walked
    // without anybody remembering to add it.
    const nav = page.getByRole("navigation", { name: "Building sections" });
    await expect(nav).toBeVisible();

    const sections = await nav
      .getByRole("link")
      .evaluateAll((links) =>
        links
          .map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? "")
          .filter((href) => href.startsWith("/b/")),
      );

    // Nine modules plus the building's own records. A shrunken nav would make
    // this whole walk vacuous.
    expect(sections.length).toBeGreaterThanOrEqual(14);

    for (const section of sections) {
      await open(page, section);

      // Follow the first record into its detail view. Not every section has
      // one — a building with no sublets on file is a valid building — so an
      // empty list is not a failure. A detail view that throws is.
      //
      // Every link is considered, not just the first: the first link on most
      // list pages is the one that creates a record ("File an alteration"),
      // and taking it and giving up meant this walk silently skipped the
      // alteration and booking detail views entirely.
      const hrefs = await page
        .getByRole("main")
        .getByRole("link")
        .evaluateAll((links) =>
          links.map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? ""),
        );

      const record = hrefs.find((href) => /\/[0-9a-f-]{36}(\/|$)/.test(href));
      if (record) await open(page, record);
    }
  });
}

/**
 * Alterations, which had no browser test at all.
 *
 * It is a module in its own right — a shareholder files, the board decides,
 * and the contractor's certificate hangs off the decision — and until now the
 * only thing standing behind the whole path was unit tests. The three
 * checkboxes are the questions a co-op board always ends up asking, so the
 * thing worth proving is that they survive the round trip and appear on the
 * request the board reads.
 */
test("a shareholder files an alteration and the board sees what it asked", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const stamp = Date.now().toString(36);
  const title = `Kitchen refit ${stamp}`;

  await signIn(page, PRESIDENTS.adelaide, baseURL ?? "http://localhost:3000");

  await open(page, "/b/adelaide/alterations");
  await page
    .getByRole("link", { name: /File an alteration|New request|File/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/alterations\/new$/);

  await page.getByLabel("What is the work?").fill(title);
  await page
    .getByLabel("Describe it")
    .fill("Replace cabinets and move the sink along the same wall.");

  // The wet-over-dry question is the classic refusal, and a board that cannot
  // see it was asked is a board deciding without it.
  await page.getByLabel("Wet over dry").check();
  await page.getByLabel("Touches the riser").check();

  await page.getByRole("button", { name: "Submit to the board" }).click();

  await page.waitForURL(/\/alterations\/[0-9a-f-]{36}$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  // The answers reached the record the board reads, and did not stay in the form.
  const main = page.getByRole("main");
  await expect(main).toContainText(/wet over dry/i);
  await expect(main).toContainText(/riser/i);

  // And it is on the list the board works from.
  await open(page, "/b/adelaide/alterations");
  await expect(page.getByText(title)).toBeVisible();
});

/**
 * A file, all the way to storage and back.
 *
 * Three parties have to agree for this to work and none of them is exercised
 * by a unit test: the server signs a PUT, the browser sends the bytes straight
 * to storage without passing through a function, and the server is then told
 * it landed. `tests/storage/drivers.test.ts` pins which driver is selected and
 * how a download is served, but nothing until now put an actual file through
 * the actual round trip.
 *
 * It runs on the filesystem driver, which is what the browser suite is
 * configured with. What that proves about Vercel Blob is the shape of the
 * exchange rather than the storage itself — the driver interface is the same
 * presigned PUT either way, which is exactly why it was built that way.
 */
test("a certificate goes up, is listed, and comes back down", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const stamp = Date.now().toString(36);
  const filename = `insurance-${stamp}.pdf`;

  await signIn(page, PRESIDENTS.adelaide, baseURL ?? "http://localhost:3000");

  // Documents hang off the thing they are about, so this starts at an
  // alteration rather than at the document index — the index is where they are
  // found, not where they arrive.
  await open(page, "/b/adelaide/alterations");
  const hrefs = await page
    .getByRole("main")
    .getByRole("link")
    .evaluateAll((links) =>
      links.map((link) => (link as HTMLAnchorElement).getAttribute("href") ?? ""),
    );
  const alteration = hrefs.find((href) => /\/alterations\/[0-9a-f-]{36}$/.test(href));
  expect(alteration, "no alteration on file to attach to").toBeTruthy();
  await open(page, alteration!);

  // A real PDF header, because the content type is not taken on trust.
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: filename,
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\n%\u00e2\u00e3\u00cf\u00d3\n"),
    });

  await expect(page.getByText(`${filename} uploaded.`)).toBeVisible({
    timeout: 20_000,
  });

  // It reaches the building's document index, which is the answer to "where is
  // the certificate" three years and two boards from now.
  await open(page, "/b/adelaide/documents");
  await expect(page.getByText(filename)).toBeVisible();

  // And it comes back. The download is a fresh, capability-checked URL every
  // time rather than a link that keeps working once somebody leaves the board.
  const link = page.getByRole("link", { name: filename }).first();
  const href = await link.getAttribute("href");
  expect(href).toBeTruthy();

  const bytes = await page.request.get(href!);
  expect(bytes.status()).toBeLessThan(400);
  expect(await bytes.text()).toContain("%PDF");
});

/**
 * The other half of the alterations module: the certificate.
 *
 * A co-op's exposure on somebody else's building work is the contractor's
 * insurance, and the board's whole job on an alteration is refusing to let it
 * start until the certificate is on file and current. So the register is not
 * decoration, and recording one is a write path like any other — it simply had
 * no browser test, which for a module named in the product's own status table
 * is an odd place to have none.
 */
test("a certificate is recorded and lands on the insurance register", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const stamp = Date.now().toString(36);
  const insured = `Bergen Street Builders ${stamp}`;

  await signIn(page, PRESIDENTS.adelaide, baseURL ?? "http://localhost:3000");
  await open(page, "/b/adelaide/insurance");

  await page.getByRole("button", { name: "Record a certificate" }).click();
  await page.getByLabel("Insured party").fill(insured);
  await page.getByLabel("Who they are").selectOption("CONTRACTOR");
  await page.getByLabel("Carrier").fill("Hartford Casualty");
  await page.getByLabel("Policy number").fill(`GL-${stamp}`);
  await page.getByLabel("Coverage").fill("1000000");
  await page.getByLabel("Effective from").fill(isoDaysFromNow(-1));
  await page.getByLabel("Expires").fill(isoDaysFromNow(300));

  await page.getByRole("button", { name: "Record the certificate" }).click();

  await expect(page.getByText(insured)).toBeVisible();

  // And it is still there on a fresh read, rather than only in the form's own
  // optimistic state.
  await open(page, "/b/adelaide/insurance");
  await expect(page.getByText(insured)).toBeVisible();
});
