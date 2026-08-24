"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Field, inputClass } from "~/components/patterns/Button";
import { sendSignInLinkAction, signInWithPasswordAction } from "./actions";

/**
 * Signing in.
 *
 * The password field is first because it is the one that works from a train
 * with no signal, on an address whose mail server has decided this deployment
 * is spam. The emailed link is kept underneath it, because it is what gets
 * somebody back in when the password is gone, and because a co-op that has been
 * using links for a year should not have to stop.
 *
 * The address is shared between the two forms deliberately: typing it once and
 * then choosing how to prove it is one decision, not two.
 */
export function SignInForm({ invite }: { invite: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, startTransition] = useTransition();

  function withPassword(): void {
    setError(null);
    setSent(false);
    startTransition(async () => {
      // On success the action redirects and this never returns a value.
      const result = await signInWithPasswordAction({ email, password, invite });
      if (!result.ok) setError(result.message);
    });
  }

  function withLink(): void {
    setError(null);
    setSent(false);
    startTransition(async () => {
      const result = await sendSignInLinkAction({ email, invite });
      if (result.ok) {
        setSent(true);
        router.push("/verify-request");
      } else {
        setError(result.message);
      }
    });
  }

  return (
    <div>
      {error ? (
        <p className="text-stamp mt-4 text-sm" data-testid="sign-in-error">
          {error}
        </p>
      ) : null}

      <form
        className="mt-6"
        onSubmit={(event) => {
          event.preventDefault();
          withPassword();
        }}
      >
        <Field label="Email address">
          <input
            type="email"
            name="email"
            autoComplete="username"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={inputClass}
            placeholder="you@example.com"
          />
        </Field>

        <div className="mt-3">
          <Field label="Password">
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>

        <div className="mt-4">
          <Button type="submit" intent="primary" disabled={pending} className="w-full">
            {pending ? "One moment…" : "Sign in"}
          </Button>
        </div>
      </form>

      <div className="border-limestone mt-6 border-t pt-5">
        <p className="text-ironwork-soft text-sm">
          {sent
            ? "Check your email."
            : "No password, or forgotten it? We can email you a link instead."}
        </p>
        <div className="mt-3">
          <Button
            intent="quiet"
            size="sm"
            disabled={pending || !email}
            onClick={withLink}
          >
            Email me a link
          </Button>
        </div>
      </div>
    </div>
  );
}
