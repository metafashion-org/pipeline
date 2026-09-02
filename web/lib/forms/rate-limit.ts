// Submission rate limiting for the public form endpoint.
//
// /api/forms/[formKey]/submit is deliberately unauthenticated for public forms — that is how
// someone with no account requests one. Nothing limited how often it could be called, so
// form_submissions could be filled by anyone who found the URL, and the admin review queue with
// it.
//
// ponytail: in-process fixed window, keyed by IP. It resets on deploy and each server instance
// counts separately, so it slows a flood rather than stopping a distributed one. That is the
// right size for a form a handful of artists submit per week; move the counter to Postgres or a
// shared store if this ever runs behind more than one instance and the limit needs to be real.

interface Window {
  count: number;
  resetAt: number;
}

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 5;
const MAX_TRACKED_CLIENTS = 10_000;

const windows = new Map<string, Window>();

/**
 * Records a submission attempt and says whether it is over the limit.
 *
 * Input: a key identifying the caller (their IP). Output: whether to allow it, and how many seconds until the window resets when not.
 */
export function checkSubmissionRate(clientKey: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const existing = windows.get(clientKey);

  if (!existing || now >= existing.resetAt) {
    // Bound the map the same way the auth cache is bounded: drop the oldest entry rather than
    // letting a stream of distinct IPs grow it for the life of the process.
    if (windows.size >= MAX_TRACKED_CLIENTS) {
      const oldest = windows.keys().next().value;
      if (oldest !== undefined) windows.delete(oldest);
    }
    windows.set(clientKey, { count: 1, resetAt: now + WINDOW_MS });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  existing.count += 1;
  if (existing.count > MAX_PER_WINDOW) {
    return { allowed: false, retryAfterSeconds: Math.ceil((existing.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/**
 * Best-effort caller identity for rate limiting.
 *
 * Input: the request. Output: the client IP from the proxy headers, or "unknown" when there is none.
 * x-forwarded-for is client-controlled unless a trusted proxy sets it, which is fine here: the
 * limit is a brake on casual flooding, not an authorization boundary.
 */
export function clientKeyFor(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip") || "unknown";
}
