import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3000);

/**
 * One host, everywhere.
 *
 * Auth.js builds magic links from AUTH_URL, and cookies are scoped per host —
 * `localhost` and `127.0.0.1` are different hosts to a browser. Driving the app
 * on one while it issues links on the other signs you in, redirects you to the
 * other host, and drops the session cookie on the way, which looks exactly like
 * a broken login. So the test picks the host and hands it to the server.
 */
const HOST = process.env.E2E_HOST ?? "localhost";
const baseURL = `http://${HOST}:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          // The container ships one Chromium at a fixed path rather than the
          // per-version download Playwright expects.
          ...(process.env["PLAYWRIGHT_CHROMIUM_PATH"]
            ? { executablePath: process.env["PLAYWRIGHT_CHROMIUM_PATH"] }
            : {}),
          // Outbound HTTPS goes through an agent proxy here, and the browser
          // inherits it — which sends 127.0.0.1 through the proxy too, where it
          // is refused. The app under test is local; nothing should be proxied.
          args: ["--no-proxy-server"],
        },
      },
    },
  ],
  webServer: {
    command: "pnpm build && pnpm start",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      AUTH_URL: baseURL,
      EMAIL_DRIVER: "catcher",
      STORAGE_DRIVER: "local",
      // `next start` sets NODE_ENV=production, and the boot guard refuses the
      // development drivers there — correctly, since a deployment that writes
      // mail to a temporary disk sends nothing. The smoke test wants exactly
      // that behaviour: it reads the magic links out of ./.mail. The opt-out is
      // ignored on Vercel, so it cannot follow this into a real deployment.
      ALLOW_DEV_DRIVERS_IN_PRODUCTION: "1",
    },
  },
});
