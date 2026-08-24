import { describe, expect, it } from "vitest";
import { MIN_PASSWORD_LENGTH, passwordProblem } from "~/lib/auth/password-rules";
import { hashPassword, needsRehash, verifyPassword } from "~/lib/auth/passwords";

/**
 * The hash, on its own.
 *
 * Nothing here touches the database. These are the properties that make a
 * stored digest worth storing: that two people who pick the same password get
 * different rows, that a digest cannot be read backwards by matching it against
 * another, and that a corrupt row reads as "wrong password" instead of taking
 * the process down with it.
 */

const GOOD = "cornice-parapet-transom-41";

describe("password rules", () => {
  it("asks for length and nothing else", () => {
    expect(passwordProblem("x".repeat(MIN_PASSWORD_LENGTH))).toBeNull();
    // No digit, no capital, no symbol. Deliberately fine.
    expect(passwordProblem("correct horse battery staple")).toBeNull();
  });

  it("refuses one that is too short, and says how long", () => {
    const problem = passwordProblem("x".repeat(MIN_PASSWORD_LENGTH - 1));
    expect(problem).toContain(String(MIN_PASSWORD_LENGTH));
  });

  it("refuses the first thing anybody guesses", () => {
    expect(passwordProblem("passwordpassword")).not.toBeNull();
    expect(passwordProblem("PasswordPassword")).not.toBeNull();
  });

  it("refuses one long enough to be a denial of service", () => {
    // 64 MB of hashing per attempt, times a megabyte of text box.
    expect(passwordProblem("x".repeat(1_000_000))).not.toBeNull();
  });
});

describe("hashing", () => {
  it("does not store the password", async () => {
    const digest = await hashPassword(GOOD);
    expect(digest).not.toContain(GOOD);
    expect(digest).not.toContain("cornice");
  });

  it("gives two people with the same password different rows", async () => {
    // Without a per-password salt, one leaked digest reveals every account that
    // chose the same thing — and in a building where everyone was handed the
    // same starter password, that is all of them.
    const a = await hashPassword(GOOD);
    const b = await hashPassword(GOOD);
    expect(a).not.toEqual(b);
    expect(await verifyPassword(GOOD, a)).toBe(true);
    expect(await verifyPassword(GOOD, b)).toBe(true);
  });

  it("records the parameters it used", async () => {
    // So that raising the cost later does not invalidate every password
    // already set: verify reads these back rather than assuming today's.
    const digest = await hashPassword(GOOD);
    const [scheme, cost, blockSize, parallelisation] = digest.split("$");
    expect(scheme).toEqual("scrypt");
    expect(Number(cost)).toBeGreaterThanOrEqual(2 ** 16);
    expect(Number(blockSize)).toEqual(8);
    expect(Number(parallelisation)).toEqual(1);
  });

  it("rejects a password that is nearly right", async () => {
    const digest = await hashPassword(GOOD);
    expect(await verifyPassword(`${GOOD} `, digest)).toBe(false);
    expect(await verifyPassword(GOOD.toUpperCase(), digest)).toBe(false);
    expect(await verifyPassword(GOOD.slice(0, -1), digest)).toBe(false);
  });

  it("verifies a password typed with a different keyboard", async () => {
    // "é" can be one code point or two, and which one arrives depends on the
    // operating system rather than on the person. Both are the same password.
    const composed = "café-parapet-transom";
    const decomposed = composed.normalize("NFD");
    expect(composed).not.toEqual(decomposed);
    expect(await verifyPassword(decomposed, await hashPassword(composed))).toBe(true);
  });

  it("treats a missing or corrupt digest as wrong, not as an error", async () => {
    // An account with no password set, and a row mangled by a bad migration.
    // Both must read as "that isn't your password" rather than as a 500 that
    // tells the caller the row is interesting.
    for (const stored of [
      null,
      undefined,
      "",
      "not-a-digest",
      "scrypt$$$$",
      "scrypt$16384$8$1$$",
      "bcrypt$2b$12$abcdefghijklmnopqrstuv",
    ]) {
      expect(await verifyPassword(GOOD, stored)).toBe(false);
    }
  });

  it("refuses a digest claiming a cost that would exhaust memory", async () => {
    // These numbers come out of the database and go straight into an
    // allocation. "The database is trusted" is a sentence that ages badly.
    const absurd = `scrypt$${2 ** 30}$8$1$AAAA$AAAA`;
    expect(await verifyPassword(GOOD, absurd)).toBe(false);
  });

  it("knows when a digest was made with weaker parameters", async () => {
    expect(needsRehash(await hashPassword(GOOD))).toBe(false);
    expect(needsRehash("scrypt$16384$8$1$AAAA$AAAA")).toBe(true);
    expect(needsRehash(null)).toBe(true);
  });
});
