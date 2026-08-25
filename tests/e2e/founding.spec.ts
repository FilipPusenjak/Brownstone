import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * The first person in a co-op.
 *
 * Every other way into this product is invitation-shaped, and every other
 * browser test starts from a seeded membership that already exists. This one
 * starts from nothing: a stranger with an email address, no account, no
 * building, nobody to be invited by. They sign in, set their building up, and
 * come out the far side able to invite the rest of the board.
 *
 * The path matters more than its length. Until it existed, a real co-op could
 * not begin using Co-operator at all — the two buildings in the product came
 * out of a seed script, which is not a thing a board president has.
 *
 * The city lookup is deliberately not exercised here. `Enter it myself` is the
 * path that has to work when Socrata is having a bad morning, and a browser
 * test that calls a third-party API is a test that goes red for reasons that
 * have nothing to do with this repository.
 */

const MAIL_DIR = ".mail";

/** A fresh address and a fresh building name per run, against a kept database. */
const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const founderEmail = `wilhelmina.oduya.${stamp}@example.com`;
const buildingName = `Calyer ${stamp}`;

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

test.describe("somebody sets their building up", () => {
  test("sign up, found it, and invite the next person in", async ({
    page,
    baseURL,
  }) => {
    test.slow();
    const base = baseURL ?? "http://127.0.0.1:3000";

    // ---- An account that belongs to nothing ---------------------------------
    await signIn(page, founderEmail, base);

    // The dead end that used to be the end of the road. Signing in works; there
    // is simply nothing to sign in to yet.
    // Matched loosely: the interface sets a typographic apostrophe, and a
    // straight one here would be a test that fails on punctuation.
    await expect(page.getByRole("heading", { name: /You.re signed in/ })).toBeVisible();
    await page.getByRole("link", { name: "Set up a building" }).click();
    await expect(page).toHaveURL(/\/start$/);

    // ---- Where is it --------------------------------------------------------
    await page.getByLabel("What do you call it?").fill(buildingName);
    await page.getByLabel("Street address").fill("128 Calyer Street");
    await page.getByLabel("Borough").selectOption("BROOKLYN");
    await page.getByLabel("ZIP").fill("11222");

    // The degraded path, on purpose. Nothing below depends on the city having
    // heard of this address.
    await page.getByRole("button", { name: "Enter it myself" }).click();

    // ---- What kind of building ----------------------------------------------
    await expect(
      page.getByRole("heading", { name: "What kind of building?" }),
    ).toBeVisible();

    await page.getByLabel("Storeys").fill("3");
    await page.getByLabel("Year built").fill("1901");
    await page.getByLabel("Landmarked, or in a historic district").check();

    // ---- The apartments ------------------------------------------------------
    // The form proposed a list from the shape of the building; the founder
    // corrects it, which is the whole intent of proposing rather than demanding.
    await expect(page.getByRole("heading", { name: "The apartments" })).toBeVisible();

    const firstShares = page.getByLabel("Apartment 1 shares");
    await expect(firstShares).toHaveValue("100");

    // An even split is what the form proposes and almost never what the
    // offering plan says. The garden apartment is the small one.
    await firstShares.fill("140");
    await page.getByLabel("Apartment 2 shares").fill("260");

    // Percentages update against the running total as the numbers are typed,
    // because shares only ever matter as proportions.
    await expect(page.getByText("Of the whole")).toBeVisible();

    const apartmentCount = await page.getByLabel(/Apartment \d+ name/).count();
    expect(apartmentCount).toBeGreaterThanOrEqual(2);
    const ownApartment = await page.getByLabel("Apartment 2 name").inputValue();

    // ---- And you -------------------------------------------------------------
    await page
      .getByLabel("Which apartment is yours?")
      .selectOption({ label: ownApartment });
    await page.getByLabel("How should you be listed?").fill("Board President");

    await page.getByRole("button", { name: "Set the building up" }).click();

    // ---- Which laws apply ----------------------------------------------------
    // The founder lands on the rules page and not on a filled-in calendar. The
    // engine has an opinion about every rule; none of them is on the calendar
    // until the board says so.
    // Generous, and for a reason worth naming: setting a building up asks the
    // city about the address to establish provenance, and that call has its own
    // bounded budget on top of the transaction. The default five seconds is
    // under the worst case rather than over it.
    await expect(page).toHaveURL(/\/b\/[^/]+\/compliance\/rules$/, {
      timeout: 20_000,
    });
    const slug = new URL(page.url()).pathname.split("/")[2] ?? "";
    expect(slug).toBeTruthy();

    await page.goto(`/b/${slug}/compliance`);
    await expect(
      page.getByRole("heading", { name: "What this building owes the city" }),
    ).toBeVisible();

    // Nothing has been decided, so nothing is owed yet. A calendar a machine
    // filled in is a calendar no board member owns, and the engine's opinion is
    // an opinion until somebody says otherwise.
    await expect(page.getByText("Nothing on the calendar yet")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Waiting for the board" }),
    ).toBeVisible();

    // The engine reasoned off the attributes typed two screens ago, and says so
    // in those terms: six apartments because six were listed, 1901 because that
    // is the year given. Neither number came from a lookup on this run.
    await expect(
      page.getByText(/unit count is 6, which is at least 3/).first(),
    ).toBeVisible();
    await expect(
      page.getByText(/year built is 1901, which is under 1960/).first(),
    ).toBeVisible();

    // ---- The board confirms one, and it reaches the calendar -----------------
    const registration = page
      .getByRole("listitem")
      .filter({ hasText: "HPD property registration" })
      .first();
    await registration.getByRole("button", { name: "Add to the calendar" }).click();

    await expect(page.getByText("Nothing on the calendar yet")).toBeHidden();
    await expect(page.getByText("HPD property registration").first()).toBeVisible();

    // ---- The apartments came through ----------------------------------------
    await page.goto(`/b/${slug}/units`);
    await expect(page.getByText(ownApartment, { exact: false }).first()).toBeVisible();

    // The share register does not warn about itself, because two of these
    // numbers were typed. Had the even split been left alone it would say so
    // out loud — quorum and every assessment divide by this table.
    await expect(
      page.getByText("Every apartment here holds the same number of shares"),
    ).toHaveCount(0);

    // ---- And the founder can bring the rest of the board in ------------------
    // The point of being made president: the invitation chain now has somebody
    // to start it. Without this the building would be a room with one person in
    // it and no door.
    await page.goto(`/b/${slug}/members`);
    await expect(
      page
        .getByRole("button", { name: /invite/i })
        .or(page.getByRole("link", { name: /invite/i }))
        .first(),
    ).toBeVisible();

    // ---- And nothing else on the deployment -----------------------------------
    // Founding a building grants sight of that building. The Adelaide has been
    // sitting in this database the whole time, and this account is as much a
    // stranger to it now as it was before signing up.
    //
    // Row-level security is asserted directly in `tests/founding/found.test.ts`;
    // what this adds is that the guarantee survives the whole stack — session,
    // context resolution, routing — and arrives as a refusal on a screen.
    const trespass = await page.goto("/b/adelaide");
    expect(trespass?.status()).toBeGreaterThanOrEqual(400);
    await expect(page.getByText("The Adelaide")).toHaveCount(0);
  });
});
