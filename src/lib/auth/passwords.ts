import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

export { MIN_PASSWORD_LENGTH, passwordProblem } from "./password-rules";

/**
 * Hashing a password, and checking one.
 *
 * Co-operator started with emailed links and nothing else, on the reasoning
 * that a three-person board will not configure OAuth and that a password is one
 * more thing to lose. That reasoning holds right up until the mail does not
 * arrive — a bounced address, a spam folder, a sending domain that is not
 * verified yet — and then the board is locked out of its own building's record
 * with no way back in. A link is a fine convenience and a poor sole key.
 *
 * So: a password is an *alternative*, not a replacement. Both work, the link
 * still exists, and the link is what recovers an account whose password is
 * forgotten.
 *
 * **scrypt, not bcrypt or argon2.** Both are better-known and both arrive as
 * native modules that have to compile for the deployment target. `node:crypto`
 * ships scrypt, it is memory-hard, and it is what the platform gives you with
 * no build step and no supply chain. The parameters below are the OWASP
 * baseline (N=2^16, r=8, p=1, ~64 MB), which costs about a tenth of a second on
 * the serverless runtime this deploys to — slow enough to matter to somebody
 * guessing, fast enough not to be noticed signing in.
 *
 * **The digest carries its own parameters.** `scrypt$N$r$p$salt$hash`. Raising
 * the cost later must not invalidate every password already set, so verify
 * reads the parameters out of the stored string rather than assuming today's.
 */

/**
 * `promisify` resolves to the three-argument overload, which drops the options
 * object — and with it every parameter that makes this a password hash rather
 * than a slow way to shorten a string. Named explicitly so the cost cannot be
 * silently discarded.
 */
const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Uint8Array,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** OWASP's scrypt baseline. Changing these only affects passwords set after. */
const COST = 2 ** 16;
const BLOCK_SIZE = 8;
const PARALLELISATION = 1;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

/**
 * scrypt's memory use is roughly `128 * N * r` bytes — 64 MB at the parameters
 * above — and Node's default cap is 32 MB, which would simply throw. Raising it
 * here rather than at the call site keeps the two numbers next to each other.
 */
const MAX_MEMORY = 128 * COST * BLOCK_SIZE * 2;

/** Hashes a password for storage. The result is safe to write to the database. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, COST, BLOCK_SIZE, PARALLELISATION);
  return [
    "scrypt",
    COST,
    BLOCK_SIZE,
    PARALLELISATION,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

/**
 * Whether a password matches a stored digest.
 *
 * Never throws on a malformed digest — a row corrupted by a bad migration must
 * read as "wrong password" and not as a 500 that tells the caller the row is
 * interesting.
 */
export async function verifyPassword(
  password: string,
  stored: string | null | undefined,
): Promise<boolean> {
  const parsed = parse(stored);
  if (!parsed) return false;
  if (password.length > 1000) return false;

  let derived: Buffer;
  try {
    derived = await derive(
      password,
      parsed.salt,
      parsed.cost,
      parsed.blockSize,
      parsed.parallelisation,
    );
  } catch {
    return false;
  }

  return (
    derived.length === parsed.key.length &&
    timingSafeEqual(new Uint8Array(derived), new Uint8Array(parsed.key))
  );
}

/**
 * Whether a digest was made with parameters weaker than today's.
 *
 * Nothing calls this yet. It exists so that raising the cost is a two-line
 * change — rehash on the next successful sign-in — rather than a migration
 * nobody can write, since the plaintext only exists during that one request.
 */
export function needsRehash(stored: string | null | undefined): boolean {
  const parsed = parse(stored);
  if (!parsed) return true;
  return (
    parsed.cost < COST ||
    parsed.blockSize < BLOCK_SIZE ||
    parsed.parallelisation < PARALLELISATION
  );
}

interface Parsed {
  readonly cost: number;
  readonly blockSize: number;
  readonly parallelisation: number;
  readonly salt: Buffer;
  readonly key: Buffer;
}

function parse(stored: string | null | undefined): Parsed | null {
  if (!stored) return null;

  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;

  const cost = Number(parts[1]);
  const blockSize = Number(parts[2]);
  const parallelisation = Number(parts[3]);

  // Bounded, because these numbers come out of the database and go straight
  // into a memory allocation. A row claiming N = 2^40 would take the process
  // down, and "the database is trusted" is a sentence that ages badly.
  const sane = (value: number, max: number) =>
    Number.isInteger(value) && value > 0 && value <= max;
  if (!sane(cost, 2 ** 20) || !sane(blockSize, 32) || !sane(parallelisation, 16)) {
    return null;
  }

  const salt = Buffer.from(parts[4]!, "base64url");
  const key = Buffer.from(parts[5]!, "base64url");
  if (salt.length === 0 || key.length === 0) return null;

  return { cost, blockSize, parallelisation, salt, key };
}

function derive(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelisation: number,
): Promise<Buffer> {
  return scryptAsync(password.normalize("NFKC"), new Uint8Array(salt), KEY_BYTES, {
    N: cost,
    r: blockSize,
    p: parallelisation,
    maxmem: Math.max(MAX_MEMORY, 128 * cost * blockSize * 2),
  });
}
