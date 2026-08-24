"use client";

import { useState, useTransition } from "react";
import { Button, Field, inputClass } from "~/components/patterns/Button";
import { MIN_PASSWORD_LENGTH } from "~/lib/auth/password-rules";
import { setPasswordAction } from "./actions";

/**
 * Setting a password, or changing one.
 *
 * The current password is asked for only when there is one. Somebody who got
 * here by an emailed link has already proved the same thing a reset email would
 * prove, and demanding a password they have never had would be a locked door
 * with no key cut for it.
 *
 * Changing one signs every other browser out. That is stated on the form rather
 * than discovered afterwards on a phone.
 */
export function PasswordForm({ hasPassword }: { hasPassword: boolean }) {
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [fieldError, setFieldError] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(): void {
    setError(null);
    setFieldError({});
    setDone(false);

    startTransition(async () => {
      const result = await setPasswordAction({ current, password, confirm });
      if (result.ok) {
        setDone(true);
        setCurrent("");
        setPassword("");
        setConfirm("");
      } else {
        setError(result.message);
        setFieldError(result.fields ?? {});
      }
    });
  }

  return (
    <form
      className="mt-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {done ? (
        <div className="border-complete-line bg-complete-soft mb-4 border-l-2 px-3 py-2">
          <p className="text-ironwork text-sm">
            Password set. Any other browser you were signed in on has been signed out.
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="text-stamp mb-3 text-sm" data-testid="password-error">
          {error}
        </p>
      ) : null}

      {hasPassword ? (
        <div className="mb-3">
          <Field label="Current password" error={fieldError["current"]}>
            <input
              type="password"
              autoComplete="current-password"
              required
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              className={inputClass}
            />
          </Field>
        </div>
      ) : null}

      <Field
        label={hasPassword ? "New password" : "Choose a password"}
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
        <Button type="submit" intent="primary" size="sm" disabled={pending}>
          {pending
            ? "Saving…"
            : hasPassword
              ? "Change the password"
              : "Set the password"}
        </Button>
      </div>
    </form>
  );
}
