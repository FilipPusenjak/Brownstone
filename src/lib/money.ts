/**
 * Money is integer cents. Always.
 *
 * The branded type makes it a type error to pass a raw number where an amount
 * is expected, which is the only reliable way to stop `2.5` — meaning two
 * dollars fifty — from being read as two and a half cents somewhere three
 * modules away.
 */

declare const brand: unique symbol;

export type Money = number & { readonly [brand]: "Money" };

export function money(cents: number): Money {
  if (!Number.isInteger(cents)) {
    throw new TypeError(
      `Money must be an integer number of cents, received ${cents}. ` +
        `Use dollars(${cents}) if you meant a dollar amount.`,
    );
  }
  if (!Number.isSafeInteger(cents)) {
    throw new TypeError(`Money is out of safe integer range: ${cents}`);
  }
  return cents as Money;
}

export const ZERO: Money = money(0);

/** Converts a dollar amount to Money, rounding to the nearest cent. */
export function dollars(amount: number): Money {
  return money(Math.round(amount * 100));
}

export function add(...amounts: Money[]): Money {
  return money(amounts.reduce<number>((total, n) => total + n, 0));
}

export function subtract(a: Money, b: Money): Money {
  return money(a - b);
}

export function negate(a: Money): Money {
  return money(-a);
}

export function isZero(a: Money): boolean {
  return a === 0;
}

export function isNegative(a: Money): boolean {
  return a < 0;
}

/**
 * Parses user input: "1,250.00", "$1250", "1250". Returns null on anything it
 * cannot read, so the caller can say so rather than posting a silent zero.
 */
export function parseMoney(input: string): Money | null {
  const cleaned = input.trim().replace(/[$,\s]/g, "");
  if (cleaned === "" || !/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return dollars(Number(cleaned));
}

const FORMATTER = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

/** "$1,250.00" */
export function formatMoney(amount: Money): string {
  return FORMATTER.format(amount / 100);
}

/**
 * "1,250.00" — no symbol, for tabular columns where the header already says
 * dollars and a column of repeated `$` is noise.
 */
export function formatAmount(amount: Money): string {
  return (amount / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
