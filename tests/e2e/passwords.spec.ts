import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Getting in without waiting for an email.
 *
 * The run below is the module's whole argument. A board member invites a
 * neighbour and copies the link — the same thing they would do if the
 * neighbour's mail were bouncing, which is the situation this exists for. The
 * neighbour opens it, picks a password, and is inside the building. Then they
 * sign out, sign back in with the password, change it, and find that the old
 * one no longer works.
 *
 * Nothing in that sequence reads a mailbox except the president's first
 * sign-in, which is still the magic link and still works.
 */

const MAIL_DIR = ".mail";
const PRESIDENT = "nora.whitfield@example.com";

const FIRST_PASSWORD = "cornice-parapet-transom-41";
const SECOND_PASSWORD = "areaway-shutter-brickwork-9";

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

/** The emailed link, which is still one of the two ways in. */
async function signInByLink(page: Page, email: string, baseURL: string): Promise<void> {
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

async function signInWithPassword(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto("/sign-in");
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function signOut(page: Page): Promise<void> {
  await page.goto("/account");
  await page.getByRole("button", { name: "Sign out" }).click();
  await page.waitForURL(/\/sign-in/);
}

test("a neighbour joins from a copied link and never sees an email", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";
  // A fresh address each run: an invitation to somebody already in the building
  // is refused, correctly.
  const email = `e2e.${Date.now().toString(36)}@example.com`;

  // ---- The board sends an invitation and copies the link ------------------
  await signInByLink(page, PRESIDENT, base);
  await page.goto("/b/adelaide/members");

  await page.getByRole("button", { name: "Invite a neighbour" }).click();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send the invitation" }).click();

  await expect(page.getByText(`Invitation sent to ${email}`)).toBeVisible();
  const link = await page.getByTestId("invitation-link").innerText();
  const token = link.split("/invite/")[1]!.trim();
  expect(token.length).toBeGreaterThan(20);

  await signOut(page);

  // ---- The neighbour opens it and picks a password ------------------------
  await page.goto(`/invite/${token}`);
  await expect(page.getByText(/no second email to wait for/)).toBeVisible();

  // The address is not a field to fill in — the invitation already names it.
  await expect(page.getByLabel("Email address")).toHaveValue(email);

  await page.getByLabel("Your name").fill("Test Neighbour");
  await page.getByLabel("Choose a password").fill(FIRST_PASSWORD);
  await page.getByLabel("And again").fill(FIRST_PASSWORD);
  await page.getByRole("button", { name: /^Create the account and join/ }).click();

  // Straight into the building, signed in, no second step.
  await page.waitForURL(/\/b\/adelaide/);
  await expect(page.getByText("Test Neighbour")).toBeVisible();

  // ---- Out, and back in with the password ---------------------------------
  await signOut(page);
  await signInWithPassword(page, email, FIRST_PASSWORD);
  await page.waitForURL(/\/b\/adelaide/);

  // ---- Changing it invalidates the old one --------------------------------
  await page.goto("/account");
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await page.getByLabel("Current password").fill(FIRST_PASSWORD);
  await page.getByLabel("New password").fill(SECOND_PASSWORD);
  await page.getByLabel("And again").fill(SECOND_PASSWORD);
  await page.getByRole("button", { name: "Change the password" }).click();
  await expect(page.getByText(/Password set\./)).toBeVisible();

  await signOut(page);

  await signInWithPassword(page, email, FIRST_PASSWORD);
  const forMember = await page.getByTestId("sign-in-error").innerText();
  await expect(page).toHaveURL(/\/sign-in/);

  // ---- And the refusal says nothing about who lives here ------------------
  // "No account with that address" and "wrong password" are two different
  // facts, and telling them apart is how a stranger learns who is a member.
  await signInWithPassword(page, "nobody.at.all@example.com", FIRST_PASSWORD);
  const forStranger = await page.getByTestId("sign-in-error").innerText();
  expect(forStranger).toEqual(forMember);

  await signInWithPassword(page, email, SECOND_PASSWORD);
  await page.waitForURL(/\/b\/adelaide/);
});

test("an invitation cannot set a password on an address that already has one", async ({
  page,
  baseURL,
}) => {
  test.slow();
  const base = baseURL ?? "http://localhost:3000";

  // Nora already has an account. Inviting her address to the *other* building
  // must offer a sign-in, not a password field — otherwise a board anywhere
  // could reset the password of a member somewhere else.
  await signInByLink(page, "ivan.petrosyan@example.com", base);
  await page.goto("/b/lispenard-house/members");

  await page.getByRole("button", { name: "Invite a neighbour" }).click();
  await page.getByLabel("Email address").fill(PRESIDENT);
  await page.getByRole("button", { name: "Send the invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${PRESIDENT}`)).toBeVisible();

  const link = await page.getByTestId("invitation-link").innerText();
  const token = link.split("/invite/")[1]!.trim();

  await signOut(page);

  await page.goto(`/invite/${token}`);
  await expect(page.getByText(/already has a Co-operator account/)).toBeVisible();
  await expect(page.getByLabel("Choose a password")).toHaveCount(0);
});
