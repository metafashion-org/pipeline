const CURRENCY_SYMBOLS: Record<string, string> = { INR: "₹", USD: "$", EUR: "€", RUB: "₽" };

/** Formats a fee/total as "₹1,234" — falls back to the raw currency code if it isn't one of the four this app supports. */
export function formatCurrency(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
  return `${symbol}${amount.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
