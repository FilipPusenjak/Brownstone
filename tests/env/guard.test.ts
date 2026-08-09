import { afterEach, describe, expect, it } from "vitest";
import { env, resetEnvCache } from "~/lib/env";

/**
 * The boot guard.
 *
 * Two of these checks exist because the failure they prevent is silent: a
 * deployment running the catcher driver writes every notice to a temporary disk
 * and reports success, so a building would believe its window-guard notices went
 * out. Nothing surfaces that until someone asks why they never got one.
 *
 * The smoke test needs those drivers under a production build, so there is an
 * opt-out — and the opt-out is what these tests are really about. It has to be
 * impossible to carry into a real deployment.
 */

const SAVED = { ...process.env };

function reset(): void {
  for (const key of Object.keys(process.env)) {
    if (!(key in SAVED)) delete process.env[key];
  }
  Object.assign(process.env, SAVED);
  resetEnvCache();
}

afterEach(reset);

function asProduction(overrides: Record<string, string> = {}): void {
  Object.assign(process.env, {
    NODE_ENV: "production",
    EMAIL_DRIVER: "catcher",
    STORAGE_DRIVER: "local",
    ...overrides,
  });
  delete process.env["NEXT_PHASE"];
  resetEnvCache();
}

describe("the environment guard", () => {
  it("refuses to serve traffic with the development drivers", () => {
    asProduction();
    expect(() => env()).toThrow(/EMAIL_DRIVER/);
    resetEnvCache();
    expect(() => env()).toThrow(/STORAGE_DRIVER/);
  });

  it("allows them during a production build, which mails nothing", () => {
    asProduction();
    process.env["NEXT_PHASE"] = "phase-production-build";
    resetEnvCache();
    expect(() => env()).not.toThrow();
  });

  it("allows them behind the explicit opt-out the smoke test uses", () => {
    asProduction({ ALLOW_DEV_DRIVERS_IN_PRODUCTION: "1" });
    expect(() => env()).not.toThrow();
  });

  it("ignores the opt-out on Vercel, where it would do real harm", () => {
    // This is the point of the flag's design. Someone pasting it into a Vercel
    // project's environment to make a deploy boot must not thereby switch the
    // building's mail off.
    asProduction({ ALLOW_DEV_DRIVERS_IN_PRODUCTION: "1", VERCEL: "1" });
    expect(() => env()).toThrow(/EMAIL_DRIVER/);
  });

  it("still requires a Resend key when Resend is selected", () => {
    asProduction({ EMAIL_DRIVER: "resend", STORAGE_DRIVER: "local" });
    delete process.env["RESEND_API_KEY"];
    delete process.env["RESEND_WEBHOOK_SECRET"];
    resetEnvCache();
    expect(() => env()).toThrow(/RESEND_API_KEY/);
  });

  it("names every missing variable at once rather than one per restart", () => {
    asProduction({ EMAIL_DRIVER: "resend", STORAGE_DRIVER: "s3" });
    delete process.env["RESEND_API_KEY"];
    delete process.env["S3_BUCKET"];
    resetEnvCache();

    try {
      env();
      expect.unreachable("the guard should have refused");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("RESEND_API_KEY");
      expect(message).toContain("S3_BUCKET");
    }
  });
});
