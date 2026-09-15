// Currency codes an asset can be priced in, mapped to the symbol shown before the amount.
export const CURRENCY_SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", RUB: "₽" };

// MetaFashion pays in INR unless an asset says otherwise, matching the default on assets.currency.
export const DEFAULT_CURRENCY = "INR";

// Digit grouping for amounts ("1,200"), pinned so server and browser render the same string.
const AMOUNT_LOCALE = "en-US";

/**
 * Formats a fee with its currency symbol, for example "₹800" or "€1,200".
 * Input: the amount as a number or a numeric string (Drizzle returns numeric columns as strings), the currency code, and the text to show when there is no amount. Output: the display string. An unknown currency shows the amount with no symbol, and a non-numeric string is shown as given.
 */
export function formatFee(
  fee: string | number | null | undefined,
  currency: string | null | undefined,
  emptyText = "-"
): string {
  if (fee === null || fee === undefined || fee === "") return emptyText;
  const symbol = CURRENCY_SYMBOLS[currency || DEFAULT_CURRENCY] ?? "";
  const amount = Number(fee);
  return Number.isFinite(amount) ? `${symbol}${amount.toLocaleString(AMOUNT_LOCALE)}` : `${symbol}${fee}`;
}
