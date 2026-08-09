import { beforeAll, describe, expect, it } from "vitest";

/**
 * The cron endpoint's front door.
 *
 * Anyone who can call this can make the building's board receive email, so the
 * shared secret is the whole gate. The comparison is constant-time; a plain
 * `===` would leak the secret's prefix a byte at a time to anyone patient
 * enough to measure, and this endpoint is reachable from the internet by
 * design.
 */
describe("the cron endpoint", () => {
  let GET: (request: Request) => Promise<Response>;
  let POST: (request: Request) => Promise<Response>;
  let secret: string;

  beforeAll(async () => {
    secret = process.env["CRON_SECRET"] ?? "";
    expect(secret.length).toBeGreaterThan(15);
    ({ GET, POST } = await import("~/app/api/cron/run/route"));
  });

  const url = "https://example.test/api/cron/run";

  it("refuses a request with no authorization header", async () => {
    expect((await GET(new Request(url))).status).toEqual(401);
  });

  it("refuses the wrong secret", async () => {
    const response = await GET(
      new Request(url, { headers: { authorization: "Bearer not-the-secret" } }),
    );
    expect(response.status).toEqual(401);
  });

  it("refuses a correct prefix", async () => {
    // The failure mode a non-constant-time compare invites.
    const response = await GET(
      new Request(url, { headers: { authorization: `Bearer ${secret.slice(0, -1)}` } }),
    );
    expect(response.status).toEqual(401);
  });

  it("refuses the secret without the Bearer scheme", async () => {
    expect(
      (await GET(new Request(url, { headers: { authorization: secret } }))).status,
    ).toEqual(401);
  });

  it("runs on GET, which is what Vercel Cron sends", async () => {
    const response = await GET(
      new Request(url, { headers: { authorization: `Bearer ${secret}` } }),
    );
    expect(response.status).toEqual(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    // Every run reports what it did, including the quiet ones. "Did the cron
    // run yesterday?" is the first question when a reminder doesn't arrive.
    expect(body).toHaveProperty("remindersDue");
    expect(body).toHaveProperty("sent");
    expect(body).toHaveProperty("durationMs");
  });

  it("runs on POST too, for an external scheduler", async () => {
    const response = await POST(
      new Request(url, {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
      }),
    );
    expect(response.status).toEqual(200);
  });

  it("is safe to invoke twice", async () => {
    // Vercel Cron does not guarantee exactly-once delivery, and someone will
    // eventually curl this by hand to see what it does.
    const first = await GET(
      new Request(url, { headers: { authorization: `Bearer ${secret}` } }),
    );
    const second = await GET(
      new Request(url, { headers: { authorization: `Bearer ${secret}` } }),
    );

    expect(first.status).toEqual(200);
    expect(second.status).toEqual(200);
    expect(((await second.json()) as { sent: number }).sent).toEqual(0);
  });
});
