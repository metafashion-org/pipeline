/**
 * Date formatting that renders identically on the server and in the browser.
 *
 * `toLocaleDateString()` with no arguments uses the host's locale and timezone. During server rendering that is the server's (UTC on most hosts) and after hydration it is the viewer's, so the same timestamp produces two different strings and React reports a hydration mismatch. Pinning both removes the mismatch and, incidentally, makes the pipeline's dates consistent for a team that is not all in one place.
 *
 * The team operates out of India, so dates are shown in that timezone rather than the viewer's.
 */
const LOCALE = "en-GB";
const TIME_ZONE = "Asia/Kolkata";

const dateFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: TIME_ZONE,
});

const dateTimeFormatter = new Intl.DateTimeFormat(LOCALE, {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: TIME_ZONE,
});

/**
 * Formats a date as "20 Aug 2026". Input: a Date, ISO string, or null. Output: the formatted date, or "-" when there is nothing to show.
 */
export function formatDate(value: Date | string | null | undefined, fallback = "-"): string {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : dateFormatter.format(date);
}

/**
 * Formats a date and time as "20 Aug 2026, 19:45". Input and output as formatDate.
 */
export function formatDateTime(value: Date | string | null | undefined, fallback = "-"): string {
  if (!value) return fallback;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : dateTimeFormatter.format(date);
}
