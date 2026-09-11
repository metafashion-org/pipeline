import { unstable_cache, revalidateTag } from "next/cache";

// Cache tags for the dashboard views. Every view listed here reads the same rows for every admin who opens it, so the work of building it can be done once and reused until something writes to those rows.
//
// The pages themselves stay dynamic — each render still reads the session and still decides access per request. What is cached is the database work behind the page, keyed by tag, so switching from Marketing to Knowledge and back does not re-run the same queries.
export const CACHE_TAGS = {
  publisherQueue: "publisher-queue",
  knowledge: "knowledge",
  marketing: "marketing",
  curationFields: "curation-fields",
  forms: "forms",
  personnel: "personnel",
  onboardingRequests: "onboarding-requests",
} as const;

export type CacheTag = (typeof CACHE_TAGS)[keyof typeof CACHE_TAGS];

// A ceiling, not the main mechanism. Writes call revalidateTag, so a view is normally correct the moment it changes; this only decides how long a view could stay wrong if an invalidation is ever missed, or if a row is changed outside this app (directly in the database, or by the Discord bot).
export const DEFAULT_REVALIDATE_SECONDS = 300;

/**
 * Wraps a data loader in the Next.js data cache under one or more tags.
 *
 * Input: the loader, a key that identifies this loader (and any arguments folded into it), and the tags that invalidate it. Output: a function with the same signature that returns a cached result.
 *
 * Values pass through JSON on the way into the cache, so a loader must return plain data — dates as ISO strings, not Date objects. The loaders in this app return exactly the props their page hands to a client component, which are already in that form.
 */
export function cachedView<Args extends unknown[], T>(
  loader: (...args: Args) => Promise<T>,
  keyParts: string[],
  tags: CacheTag[],
  revalidate: number = DEFAULT_REVALIDATE_SECONDS
): (...args: Args) => Promise<T> {
  return unstable_cache(loader, keyParts, { tags, revalidate });
}

/**
 * Drops the cached views behind one or more tags.
 *
 * Input: the tags a write has just invalidated. Output: none. Call it from a route handler after the write succeeds, so the next render of those views reads the new rows instead of waiting out the revalidate window.
 */
export function revalidateViews(...tags: CacheTag[]): void {
  // "max" is revalidateTag's strongest expiration profile: expire every cached entry carrying the
  // tag, however long it was cached for. Anything weaker would leave a longer-lived entry in place
  // after the write that made it wrong.
  for (const tag of tags) revalidateTag(tag, "max");
}
