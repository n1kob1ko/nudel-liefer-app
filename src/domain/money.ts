/**
 * Money of the office (D33, NUD-196). The catalog deliberately has no prices: the office types one
 * amount per order. Amounts are whole **euro cents** everywhere (`Int` in the database, never a
 * float), so `0.1 + 0.2` style errors cannot appear in a bill.
 */

/** Largest amount one order may carry: 999.999,99 €. Keeps `Int` far from its limit. */
export const MAX_AMOUNT_CENTS = 99_999_999;

/** What an order may carry: 0 .. MAX. A negative amount is no amount. */
export function isValidCents(cents: unknown): cents is number {
  return (
    typeof cents === "number" && Number.isInteger(cents) && cents >= 0 && cents <= MAX_AMOUNT_CENTS
  );
}

/**
 * Parses an amount typed into a form ("42", "42,50", "42.5") into euro cents. Only an optional
 * decimal comma or point is accepted: no thousands separators, no minus, no more than two decimals,
 * no currency symbol — a wrong amount on a bill is worse than a rejected input. `null` for anything
 * else (and for an empty field, which the caller reads as "no amount").
 */
export function parseAmountToCents(input: string | number): number | null {
  if (typeof input === "number") {
    if (!Number.isFinite(input) || input < 0) return null;
    // A number is an euro amount: at most two decimals, no rounding surprises.
    const cents = Math.round(input * 100);
    if (Math.abs(input * 100 - cents) > 1e-6) return null;
    return isValidCents(cents) ? cents : null;
  }
  const text = input.trim().replace(",", ".");
  if (text === "") return null;
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) return null;
  const euros = Number(match[1]);
  const decimals = Number((match[2] ?? "").padEnd(2, "0"));
  const cents = euros * 100 + decimals;
  return isValidCents(cents) ? cents : null;
}

/**
 * The plain value of an amount for an input field: `"42.50"`, `""` for "no amount". A dot is used
 * because the field accepts both; the visible money text elsewhere is formatted by next-intl.
 */
export function amountInputValue(cents: number | null | undefined): string {
  if (!isValidCents(cents)) return "";
  return (cents / 100).toFixed(2);
}

/** Sum of amounts; a missing amount counts as 0. */
export function sumCents(values: ReadonlyArray<number | null | undefined>): number {
  return values.reduce<number>((sum, value) => sum + (isValidCents(value) ? value : 0), 0);
}
