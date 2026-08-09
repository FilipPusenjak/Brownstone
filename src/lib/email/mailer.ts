import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Resend } from "resend";
import { env } from "~/lib/env";

/**
 * Email transport.
 *
 * This is the wire only. Building notices go through `src/lib/email/send.ts`,
 * which writes the notification log record *before* handing anything to a
 * driver — that log is the building's evidence that a legally required notice
 * was sent, so it must not depend on the send succeeding.
 *
 * In development the catcher driver writes `.eml` files to `./.mail` and never
 * opens a socket. Seed data contains plausible addresses at real domains, and
 * a development run that quietly mails them is not a mistake anyone gets to
 * make twice.
 */

export interface OutboundEmail {
  readonly to: string;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
  readonly from?: string;
  readonly replyTo?: string;
}

export interface SendReceipt {
  /** Provider message id, recorded on the notification for later reconciliation. */
  readonly providerMessageId: string;
  readonly driver: "catcher" | "resend";
}

export interface EmailDriver {
  send(email: OutboundEmail): Promise<SendReceipt>;
}

const MAIL_DIR = ".mail";

function slug(value: string): string {
  return value
    .replace(/[^a-z0-9]+/gi, "-")
    .toLowerCase()
    .slice(0, 60);
}

/** Writes a readable .eml to disk. No network, ever. */
export const catcherDriver: EmailDriver = {
  async send(email: OutboundEmail): Promise<SendReceipt> {
    mkdirSync(MAIL_DIR, { recursive: true });

    const id = `catcher-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const boundary = `----cooperator-${id}`;
    const file = join(
      MAIL_DIR,
      `${Date.now()}-${slug(email.to)}-${slug(email.subject)}.eml`,
    );

    const eml = [
      `From: ${email.from ?? env().EMAIL_FROM}`,
      `To: ${email.to}`,
      `Subject: ${email.subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${id}@cooperator.local>`,
      "MIME-Version: 1.0",
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      email.text,
      "",
      `--${boundary}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      email.html,
      "",
      `--${boundary}--`,
      "",
    ].join("\r\n");

    writeFileSync(file, eml, "utf8");
    console.info(`[mail] ${email.to} — ${email.subject}\n[mail] written to ${file}`);

    return { providerMessageId: id, driver: "catcher" };
  },
};

let resendClient: Resend | undefined;

export const resendDriver: EmailDriver = {
  async send(email: OutboundEmail): Promise<SendReceipt> {
    resendClient ??= new Resend(env().RESEND_API_KEY);

    const result = await resendClient.emails.send({
      from: email.from ?? env().EMAIL_FROM,
      to: email.to,
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(email.replyTo ? { replyTo: email.replyTo } : {}),
    });

    if (result.error) {
      throw new Error(`Resend refused the message: ${result.error.message}`);
    }
    if (!result.data) {
      throw new Error("Resend returned no message id.");
    }

    return { providerMessageId: result.data.id, driver: "resend" };
  },
};

export function mailer(): EmailDriver {
  return env().EMAIL_DRIVER === "resend" ? resendDriver : catcherDriver;
}
