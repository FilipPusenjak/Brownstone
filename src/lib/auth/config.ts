import { PrismaAdapter } from "@auth/prisma-adapter";
import NextAuth from "next-auth";
import type { NextAuthConfig } from "next-auth";
import { prisma } from "~/lib/db/prisma";
import { mailer } from "~/lib/email/mailer";
import { env } from "~/lib/env";

/**
 * Authentication: the emailed link half.
 *
 * This was once the whole of it. A three-person board in a twelve-unit
 * brownstone will not configure an OAuth app, and a link in email asks them to
 * remember nothing. What that missed is the day the link does not arrive — an
 * unverified sending domain, a spam filter, an address that bounces — and then
 * the board is locked out of its own building's record with no way back in. A
 * link is a fine convenience and a poor sole key.
 *
 * So there are two ways in now, and this file holds one of them. The password
 * half is `src/lib/auth/accounts.ts`, and it deliberately does not appear here:
 * Auth.js's `Credentials` provider is documented as requiring the JWT session
 * strategy, and this application needs database sessions for the reason below.
 * Password sign-in therefore writes the `Session` row itself — see
 * `src/lib/auth/sessions.ts` — and everything downstream reads the same row
 * from the same table and cannot tell which door it came through.
 *
 * Sessions are database-backed rather than JWT. A membership can be revoked
 * when someone sells their apartment, and that revocation has to take effect
 * immediately, not whenever a token happens to expire.
 */

const SIGN_IN_LINK_TTL_MINUTES = 15;

function signInEmail(url: string, host: string): { html: string; text: string } {
  const text = [
    "Sign in to Co-operator",
    "",
    `Open this link to sign in. It works once and expires in ${SIGN_IN_LINK_TTL_MINUTES} minutes.`,
    "",
    url,
    "",
    "If you didn't ask to sign in, you can ignore this email — nobody can get in without the link.",
    "",
    host,
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <body style="margin:0;padding:32px;background:#e7e9e2;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#16191a;">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#fbfbf8;border:1px solid #cfccc0;">
      <tr>
        <td style="padding:28px 28px 8px;border-bottom:1px solid #cfccc0;">
          <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;color:#6e4a38;">Co-operator</div>
        </td>
      </tr>
      <tr>
        <td style="padding:24px 28px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.5;">Open this link to sign in.</p>
          <p style="margin:0 0 24px;">
            <a href="${url}" style="display:inline-block;padding:12px 20px;background:#0b6e62;color:#ffffff;text-decoration:none;font-weight:600;">Sign in to Co-operator</a>
          </p>
          <p style="margin:0 0 16px;font-size:14px;line-height:1.5;color:#4a4f4c;">
            It works once and expires in ${SIGN_IN_LINK_TTL_MINUTES} minutes. If you didn't ask to sign in, ignore this email — nobody can get in without the link.
          </p>
          <p style="margin:0;font-size:12px;line-height:1.5;color:#6b716d;word-break:break-all;">${url}</p>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { html, text };
}

export const authConfig: NextAuthConfig = {
  adapter: PrismaAdapter(prisma),
  session: { strategy: "database" },
  trustHost: true,
  pages: {
    signIn: "/sign-in",
    verifyRequest: "/verify-request",
    error: "/sign-in",
  },
  providers: [
    {
      id: "email",
      type: "email",
      name: "Email",
      from: env().EMAIL_FROM,
      maxAge: SIGN_IN_LINK_TTL_MINUTES * 60,
      options: {},
      // Routed through Co-operator's own mailer so that the development catcher
      // applies to sign-in links too. A magic link mailed to a real address
      // during a seeded dev run is an account takeover waiting to happen.
      async sendVerificationRequest({ identifier, url }) {
        const host = new URL(url).host;
        const { html, text } = signInEmail(url, host);

        await mailer().send({
          to: identifier,
          subject: "Sign in to Co-operator",
          html,
          text,
        });
      },
    },
  ],
  callbacks: {
    session({ session, user }) {
      session.user.id = user.id;
      return session;
    },
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);
