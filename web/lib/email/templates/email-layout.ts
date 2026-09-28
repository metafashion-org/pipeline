// The one layout every pipeline email uses: offer, deadline request, deadline decision, decline and
// the full brief. Built from tables and inline styles because Gmail and Outlook drop <style> blocks,
// flexbox and grid.

/** Width of the asset picture in emails, in pixels. Also the width the Drive thumbnail is fetched at. */
export const EMAIL_IMAGE_WIDTH_PX = 600;

// Content width inside the white card, in pixels: the card is 600px wide with 32px padding either side.
const CARD_CONTENT_WIDTH_PX = 536;

const COLOR = {
  page: "#f5f5f3",
  card: "#ffffff",
  ink: "#111111",
  muted: "#6b6b6b",
  hairline: "#ebebe8",
  statBg: "#f7f7f5",
} as const;

// The small label above the title says what kind of email this is. Its colour carries the outcome.
export const EMAIL_TONE = {
  neutral: "#111111",
  good: "#15803d",
  bad: "#b91c1c",
} as const;

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

// Item names, reasons, brief values and artist names are typed by people and end up inside HTML.
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface EmailDetailRow {
  label: string;
  /** Plain text. URLs inside it become links. */
  value: string;
}

export interface EmailLayoutInput {
  /** Inbox preview text, shown after the subject in most mail apps. */
  preheader: string;
  /** Small uppercase label above the title, e.g. "New offer". */
  eyebrow: string;
  tone: string;
  title: string;
  /** SKU and accessory type, shown small under the title. */
  meta: string[];
  imageUrl: string | null;
  /** Up to two large figures, e.g. fee and deadline. */
  stats: EmailDetailRow[];
  /** One or two short sentences to the reader. */
  intro: string;
  /** Someone's own words, e.g. a decline reason, shown as a quote. */
  quote?: { label: string; text: string };
  details?: EmailDetailRow[];
  note?: string;
  button: { label: string; url: string };
  footer?: string;
}

// The capture group makes String.split keep each URL, at the odd indexes of the result.
const URL_SPLIT_PATTERN = /(https?:\/\/[^\s,]+)/;

// Escapes the text and turns each URL in it into a short numbered link, so a brief value holding
// three Drive links reads "Link 1, Link 2, Link 3" instead of three 80-character addresses.
function linkify(text: string): string {
  return text
    .split(URL_SPLIT_PATTERN)
    .map((part, i) => {
      if (i % 2 === 0) return escapeHtml(part);
      const linkNumber = (i + 1) / 2;
      return `<a href="${escapeHtml(part)}" style="color:${COLOR.ink};text-decoration:underline;">Link ${linkNumber}</a>`;
    })
    .join("");
}

function renderStats(stats: EmailDetailRow[]): string {
  if (stats.length === 0) return "";
  const cellWidthPct = Math.floor(100 / stats.length);
  const cells = stats
    .map(
      (stat, i) => `<td width="${cellWidthPct}%" style="background:${COLOR.statBg};border-radius:10px;padding:14px 16px;${i > 0 ? "border-left:8px solid #ffffff;" : ""}">
        <div style="font-size:12px;color:${COLOR.muted};letter-spacing:0.02em;">${escapeHtml(stat.label)}</div>
        <div style="font-size:20px;font-weight:600;color:${COLOR.ink};margin-top:4px;">${escapeHtml(stat.value)}</div>
      </td>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:20px 0 4px;border-collapse:separate;"><tr>${cells}</tr></table>`;
}

function renderDetails(rows: EmailDetailRow[]): string {
  if (rows.length === 0) return "";
  const rowsHtml = rows
    .map(
      (row) => `<tr>
        <td valign="top" style="padding:10px 0;border-top:1px solid ${COLOR.hairline};font-size:13px;color:${COLOR.muted};width:38%;">${escapeHtml(row.label)}</td>
        <td valign="top" style="padding:10px 0;border-top:1px solid ${COLOR.hairline};font-size:14px;color:${COLOR.ink};">${linkify(row.value)}</td>
      </tr>`
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;border-collapse:collapse;">${rowsHtml}</table>`;
}

/**
 * Builds a complete email document in the pipeline's shared layout.
 *
 * Input: the email's parts; every string is plain text and is escaped here.
 * Output: the HTML document to queue with enqueueEmail.
 */
export function renderEmailLayout(input: EmailLayoutInput): string {
  const imageHtml = input.imageUrl
    ? `<tr><td style="padding:0 32px;"><img src="${escapeHtml(input.imageUrl)}" alt="${escapeHtml(input.title)}" width="${CARD_CONTENT_WIDTH_PX}" style="display:block;width:100%;max-width:${CARD_CONTENT_WIDTH_PX}px;height:auto;border-radius:12px;background:${COLOR.statBg};" /></td></tr>`
    : "";
  const metaHtml = input.meta.filter(Boolean).map(escapeHtml).join(" &nbsp;·&nbsp; ");
  const quoteHtml = input.quote
    ? `<div style="margin-top:20px;border-left:3px solid ${COLOR.ink};padding:2px 0 2px 14px;">
        <div style="font-size:12px;color:${COLOR.muted};">${escapeHtml(input.quote.label)}</div>
        <div style="font-size:15px;color:${COLOR.ink};margin-top:4px;line-height:1.5;">${escapeHtml(input.quote.text)}</div>
      </div>`
    : "";
  const noteHtml = input.note
    ? `<div style="margin-top:20px;background:${COLOR.statBg};border-radius:10px;padding:12px 14px;font-size:13px;line-height:1.5;color:${COLOR.ink};">${escapeHtml(input.note)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:0;background:${COLOR.page};font-family:${FONT};color:${COLOR.ink};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(input.preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLOR.page};">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
        <tr><td style="padding:0 4px 16px;font-size:12px;font-weight:700;letter-spacing:0.18em;color:${COLOR.ink};">META FASHION</td></tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:${COLOR.card};border-radius:16px;">
        <tr><td style="padding:28px 32px 20px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:${input.tone};">${escapeHtml(input.eyebrow)}</div>
          <div style="font-size:24px;line-height:1.25;font-weight:700;color:${COLOR.ink};margin-top:8px;">${escapeHtml(input.title)}</div>
          ${metaHtml ? `<div style="font-size:13px;color:${COLOR.muted};margin-top:6px;">${metaHtml}</div>` : ""}
        </td></tr>
        ${imageHtml}
        <tr><td style="padding:4px 32px 32px;">
          ${renderStats(input.stats)}
          <p style="font-size:15px;line-height:1.6;color:${COLOR.ink};margin:20px 0 0;">${escapeHtml(input.intro)}</p>
          ${quoteHtml}
          ${renderDetails(input.details || [])}
          ${noteHtml}
          <table role="presentation" cellpadding="0" cellspacing="0" style="margin-top:28px;"><tr>
            <td style="background:${COLOR.ink};border-radius:999px;">
              <a href="${escapeHtml(input.button.url)}" style="display:inline-block;padding:13px 26px;font-size:14px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(input.button.label)} &rarr;</a>
            </td>
          </tr></table>
        </td></tr>
      </table>
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;">
        <tr><td style="padding:16px 4px;font-size:12px;line-height:1.5;color:${COLOR.muted};">${escapeHtml(input.footer || "Sent by the Meta Fashion pipeline.")}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}
