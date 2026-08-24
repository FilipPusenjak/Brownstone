/**
 * What counts as a usable password.
 *
 * Kept apart from `passwords.ts` because that module reaches for `node:crypto`
 * and this one must not: the form that asks for a password is a client
 * component, and it should state the same rule the server enforces rather than
 * a second copy of it that drifts. Everything here is a pure function over a
 * string.
 *
 * **Twelve characters, and nothing else.** No composition rules. Requiring a
 * digit and a symbol is how "Brownstone1!" becomes the password on every
 * account in the building; NIST dropped the advice in 2017, and length is the
 * part that actually costs an attacker anything.
 *
 * The one extra check is against the handful of strings a dictionary attack
 * tries first, spelled out below rather than pulled from a ten-megabyte list.
 * This is a co-op tool, not a bank, and a word list nobody can read in review
 * is a dependency nobody can audit.
 */

export const MIN_PASSWORD_LENGTH = 12;

/** Beyond this, a password is a paste accident and 64 MB of hashing per try. */
const MAX_PASSWORD_LENGTH = 200;

const OBVIOUS = new Set([
  "password",
  "passw0rd",
  "password1",
  "password123",
  "passwordpassword",
  "123456789012",
  "1234567890123",
  "qwertyuiop12",
  "letmein12345",
  "iloveyou1234",
  "administrator",
  "cooperator",
  "cooperator12",
  "co-operator1",
  "brownstone12",
  "brooklyn1234",
]);

/**
 * The reason a password is unusable, or null.
 *
 * Returns prose, not a code, because every caller renders it verbatim and a
 * rule the person cannot read is a rule they cannot satisfy.
 */
export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters. Length is the part that matters — three ordinary words are stronger than one word with a symbol in it.`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `That's longer than ${MAX_PASSWORD_LENGTH} characters. Something has probably gone wrong with the paste.`;
  }
  if (OBVIOUS.has(password.toLowerCase())) {
    return "That's one of the first passwords anybody guesses. Pick something else.";
  }
  return null;
}
