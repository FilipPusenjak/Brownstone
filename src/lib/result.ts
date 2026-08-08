/**
 * Typed results for Server Actions.
 *
 * A Server Action that throws produces an error boundary and a message the user
 * cannot act on. Actions here return a discriminated union instead, so the form
 * that called it can say what happened and what to do about it.
 *
 * Exceptions remain exceptions: a thrown error means a bug or an outage, not a
 * user who typed something wrong.
 */

export type Ok<T> = { readonly ok: true; readonly data: T };

export type Failure = {
  readonly ok: false;
  /** Machine-readable, for the caller to branch on. */
  readonly code: ErrorCode;
  /** Written for the person reading the screen: what happened, and what to do. */
  readonly message: string;
  /** Field-level messages, keyed by form field name. */
  readonly fields?: Record<string, string>;
};

export type Result<T> = Ok<T> | Failure;

export type ErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "invalid"
  | "conflict"
  | "expired"
  | "rate_limited"
  | "unavailable";

export function ok<T>(data: T): Ok<T> {
  return { ok: true, data };
}

export function fail(
  code: ErrorCode,
  message: string,
  fields?: Record<string, string>,
): Failure {
  return fields ? { ok: false, code, message, fields } : { ok: false, code, message };
}

export function isOk<T>(result: Result<T>): result is Ok<T> {
  return result.ok;
}

/** Unwraps a result, throwing on failure. For tests and trusted internal calls. */
export function expect<T>(result: Result<T>): T {
  if (result.ok) return result.data;
  throw new Error(`${result.code}: ${result.message}`);
}
