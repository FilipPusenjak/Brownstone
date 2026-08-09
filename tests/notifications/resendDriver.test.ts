import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resendDriver } from "~/lib/email/mailer";
import { resetEnvCache } from "~/lib/env";

/**
 * The Resend driver, pinned at the HTTP boundary.
 *
 * There is no API key in this environment, so what this can and cannot prove is
 * worth being precise about.
 *
 * It *can* prove the request Co-operator puts on the wire: the endpoint, the
 * method, the bearer token, and that the body carries `from`, `to`, `subject`,
 * `html` and `text` — including that the plain-text part is never dropped,
 * which is the whole evidentiary value of the notification log. Intercepting
 * fetch rather than mocking the SDK is deliberate: a mocked SDK would only
 * prove that Co-operator calls a function it also defines.
 *
 * It *cannot* prove that Resend accepts that request, that the sending domain
 * is verified, or that anything lands in an inbox. Those need a real key and a
 * real domain, and are noted as unverified in DECISIONS.md rather than covered
 * by a test that would pass regardless.
 */

const ORIGINAL_FETCH = globalThis.fetch;

describe("the Resend driver", () => {
  let calls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    calls = [];
    process.env["EMAIL_DRIVER"] = "resend";
    process.env["RESEND_API_KEY"] = "re_test_key";
    process.env["RESEND_WEBHOOK_SECRET"] = "whsec_test";
    resetEnvCache();

    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init: init ?? {} });
      return new Response(JSON.stringify({ id: "resend-message-id" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    process.env["EMAIL_DRIVER"] = "catcher";
    delete process.env["RESEND_API_KEY"];
    delete process.env["RESEND_WEBHOOK_SECRET"];
    resetEnvCache();
  });

  it("posts to Resend with the key as a bearer token", async () => {
    await resendDriver.send({
      to: "nora@example.com",
      subject: "Annual boiler inspection due in 9 days — The Adelaide",
      html: "<p>Due 31 Dec 2026.</p>",
      text: "Due 31 Dec 2026.",
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toContain("api.resend.com");
    expect(call?.init.method).toEqual("POST");

    const headers = new Headers(call?.init.headers);
    expect(headers.get("authorization")).toEqual("Bearer re_test_key");
  });

  it("sends both the HTML and the plain text", async () => {
    await resendDriver.send({
      to: "nora@example.com",
      subject: "Subject line",
      html: "<p>Rich version.</p>",
      text: "Plain version.",
    });

    const body = JSON.parse(String(calls[0]?.init.body ?? "{}")) as Record<string, unknown>;

    expect(body["to"]).toEqual("nora@example.com");
    expect(body["subject"]).toEqual("Subject line");
    expect(body["html"]).toEqual("<p>Rich version.</p>");
    // Dropping this would leave the notification log holding evidence that was
    // never actually sent.
    expect(body["text"]).toEqual("Plain version.");
    expect(body["from"]).toBeTruthy();
  });

  it("returns the provider's message id, which the delivery webhook matches on", async () => {
    const receipt = await resendDriver.send({
      to: "nora@example.com",
      subject: "Subject",
      html: "<p>x</p>",
      text: "x",
    });

    expect(receipt.providerMessageId).toEqual("resend-message-id");
    expect(receipt.driver).toEqual("resend");
  });

  it("throws rather than reporting success when Resend refuses", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ message: "Domain is not verified", name: "validation_error" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        }),
    ) as typeof fetch;

    // A refusal must surface: sendNotice marks the notification FAILED with the
    // reason, and a board can see that the notice did not go out. Swallowing it
    // would leave a log claiming a send that never happened.
    await expect(
      resendDriver.send({
        to: "nora@example.com",
        subject: "Subject",
        html: "<p>x</p>",
        text: "x",
      }),
    ).rejects.toThrow();
  });
});
