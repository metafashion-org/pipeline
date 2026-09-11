// Parsing and validation for the Roblox marketplace links an uploader records against an asset.
//
// The Uploader Queue used to take one link in a text box plus a separate "Roblox asset ID" box that the uploader had to copy out of that same link by hand. The id is already in the URL, so the second box could only ever agree with the first or be wrong, and nothing checked which. This file is the single place that decides what a Roblox link looks like, so the browser and the API route apply the same rule to the same text.
//
// The expected shape is a catalog item URL: https://www.roblox.com/catalog/116109904627748/Birthday-Time-Fedora

/** A link that passed validation, with the catalog id read out of its path. */
export interface ValidRobloxLink {
  /** 1-based position of the line this came from, for reporting errors against what the uploader typed. */
  line: number;
  /** Exactly what was typed, before normalisation. */
  raw: string;
  /** The link with tracking query strings and fragments removed. This is what gets stored. */
  url: string;
  /** The catalog id from the path — what the removed "Roblox asset ID" field used to ask for. */
  assetId: string;
  /** The trailing name segment, when the link has one. Shown in the UI so a mistyped link is recognisable. */
  slug: string | null;
}

/** A line that did not pass validation, with a reason a person can act on. */
export interface InvalidRobloxLink {
  line: number;
  raw: string;
  reason: string;
}

export interface ParsedRobloxLinks {
  valid: ValidRobloxLink[];
  invalid: InvalidRobloxLink[];
}

const ALLOWED_HOSTS = new Set(["roblox.com", "www.roblox.com", "m.roblox.com"]);

// Roblox catalog ids are positive integers and are never zero-padded, so a leading zero means the line was mistyped rather than that a real id was found.
const CATALOG_ID_PATTERN = /^[1-9][0-9]{0,19}$/;

/**
 * Validates one Roblox catalog link.
 *
 * Input: a single line of text. Output: the parsed link, or a string explaining why the line is not a Roblox catalog link. Callers tell the two apart with `typeof result === "string"`.
 */
export function parseRobloxCatalogLink(raw: string): Omit<ValidRobloxLink, "line" | "raw"> | string {
  const trimmed = raw.trim();
  if (!trimmed) return "Empty line.";

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "Not a URL — a Roblox link starts with https://";
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return `Unsupported protocol "${parsed.protocol.replace(":", "")}" — use https.`;
  }

  const host = parsed.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.has(host)) {
    return `"${host}" is not a Roblox address.`;
  }

  // Empty segments so a doubled or trailing slash does not shift the id's position.
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0]?.toLowerCase() !== "catalog") {
    return "Not a catalog link — it should look like https://www.roblox.com/catalog/<id>/<name>";
  }

  const assetId = segments[1];
  if (!assetId) return "No catalog id in the link.";
  if (!CATALOG_ID_PATTERN.test(assetId)) return `"${assetId}" is not a Roblox catalog id.`;

  const slug = segments[2] ? decodeURIComponent(segments[2]) : null;

  // Stored without the query string: catalog links are routinely copied out of a browser carrying share and referral parameters, and two links to the same item should not read as two different links.
  const url = `https://www.roblox.com/catalog/${assetId}${segments[2] ? `/${segments[2]}` : ""}`;

  return { url, assetId, slug };
}

/**
 * Validates a list of lines, one Roblox link per line, and reports duplicates.
 *
 * Input: the lines as typed, in order. Output: the links that validated and the lines that did not, each carrying its 1-based line number. Blank lines are skipped rather than reported. Two lines pointing at the same catalog id are a mistake worth stopping on, so the second one is reported as invalid instead of being recorded twice.
 */
export function parseRobloxLinkLines(lines: string[]): ParsedRobloxLinks {
  const valid: ValidRobloxLink[] = [];
  const invalid: InvalidRobloxLink[] = [];
  const seenAssetIds = new Map<string, number>();

  lines.forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;

    const result = parseRobloxCatalogLink(raw);
    if (typeof result === "string") {
      invalid.push({ line, raw, reason: result });
      return;
    }

    const firstSeenOn = seenAssetIds.get(result.assetId);
    if (firstSeenOn !== undefined) {
      invalid.push({ line, raw, reason: `Same item as line ${firstSeenOn}.` });
      return;
    }

    seenAssetIds.set(result.assetId, line);
    valid.push({ line, raw, ...result });
  });

  return { valid, invalid };
}

/**
 * Splits pasted text into candidate lines.
 *
 * Input: text that may use any line ending. Output: one entry per non-empty line, trimmed. Used when someone pastes a whole list into the link box at once instead of adding them one at a time.
 */
export function splitRobloxLinkText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}
