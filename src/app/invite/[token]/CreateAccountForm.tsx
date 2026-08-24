"use client";

import { useState, useTransition } from "react";
import { Button, Field, inputClass } from "~/components/patterns/Button";
import { MIN_PASSWORD_LENGTH } from "~/lib/auth/password-rules";
import { createAccountAction } from "./actions";

/**
 * Making an account, from the invitation itself.
 *
 * This is the whole of sign-up. The address is not a field, because the
 * invitation already names it and holding the link is the proof that it is
 * yours — asking again would only be a chance to type it wrong. What is left is
 * a name your neighbours will recognise on a meeting minute, and a password.
 *
 * No second email, no link to click, nothing to wait for. A board can text this
 * link to a neighbour whose mail bounces and they are inside a minute later,
 * which is the situation this replaced.
 */
export function CreateAccountForm({
  token,
  email,
  buildingName,
}: {
  token: string;
  email: string;
  buildingName: string;
}) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});
    startTransition(async () => {
      // On success the action redirects and this never returns a value.
      const result = await createAccountAction({ token, name, password, confirm });
      if (!result.ok) {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  return (
    <form
      className="mt-5"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {error ? (
        <p className="text-stamp mb-3 text-sm" data-testid="create-account-error">
          {error}
        </p>
      ) : null}

      <Field label="Your name" hint="How your neighbours will see you on a minute.">
        <input
          type="text"
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          className={inputClass}
          placeholder="Nora Whitfield"
        />
      </Field>

      {/* Present, disabled, and submitted by nothing. It is here so a password
          manager files the entry under the right address — and so the person
          can see which address they are about to become. */}
      <div className="mt-3">
        <Field
          label="Email address"
          hint="From your invitation. It can't be changed here."
        >
          <input
            type="email"
            autoComplete="username"
            value={email}
            readOnly
            className={`${inputClass} text-ironwork-soft bg-paper-sunk`}
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field
          label="Choose a password"
          hint={`At least ${MIN_PASSWORD_LENGTH} characters. Three ordinary words beat one word with a symbol in it.`}
          error={fieldError["password"]}
        >
          <input
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-3">
        <Field label="And again" error={fieldError["confirm"]}>
          <input
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            className={inputClass}
          />
        </Field>
      </div>

      <div className="mt-4">
        <Button type="submit" intent="primary" disabled={pending} className="w-full">
          {pending ? "Joining…" : `Create the account and join ${buildingName}`}
        </Button>
      </div>
    </form>
  );
}
