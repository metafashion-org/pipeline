// Reads public Roblox catalog data for our listings without signing in. Both endpoints answered
// anonymously when checked on 13 Oct 2026:
// - economy.roblox.com/v2/assets/{id}/details: one listing's name, creator, type, price, IsForSale.
// - thumbnails.roblox.com/v1/assets: square PNG URLs for up to THUMBNAIL_BATCH_SIZE ids per call.
// catalog.roblox.com's batch details endpoint needs a signed-in CSRF token, so it isn't used.

const ECONOMY_DETAILS_URL = "https://economy.roblox.com/v2/assets";
const THUMBNAILS_URL = "https://thumbnails.roblox.com/v1/assets";
// Roblox's documented maximum ids per thumbnails request.
const THUMBNAIL_BATCH_SIZE = 100;
const THUMBNAIL_SIZE = "420x420";
// Roblox's thumbnail URLs stay valid for months, so an hour of caching only saves calls.
const THUMBNAIL_CACHE_SECONDS = 60 * 60;
const REQUEST_TIMEOUT_MS = 15_000;

export interface RobloxListingDetails {
  httpStatus: number;
  isForSale: boolean | null;
  priceRobux: number | null;
  name: string | null;
  assetTypeId: number | null;
  creatorName: string | null;
  error: string | null;
}

/**
 * Input: a Roblox catalog id. Output: what Roblox shows for it, or the HTTP status and an error.
 * Never throws for a Roblox failure, so one bad listing doesn't stop a check of the rest.
 */
export async function fetchListingDetails(robloxAssetId: string, fetchImpl: typeof fetch = fetch): Promise<RobloxListingDetails> {
  const empty = { isForSale: null, priceRobux: null, name: null, assetTypeId: null, creatorName: null };
  try {
    const res = await fetchImpl(`${ECONOMY_DETAILS_URL}/${encodeURIComponent(robloxAssetId)}/details`, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
    });
    if (!res.ok) return { httpStatus: res.status, ...empty, error: `Roblox answered ${res.status}` };
    const data = await res.json();
    return {
      httpStatus: res.status,
      isForSale: typeof data.IsForSale === "boolean" ? data.IsForSale : null,
      priceRobux: typeof data.PriceInRobux === "number" ? data.PriceInRobux : null,
      name: typeof data.Name === "string" ? data.Name : null,
      assetTypeId: typeof data.AssetTypeId === "number" ? data.AssetTypeId : null,
      creatorName: typeof data.Creator?.Name === "string" ? data.Creator.Name : null,
      error: null,
    };
  } catch (err) {
    return { httpStatus: 0, ...empty, error: err instanceof Error ? err.message : "Request failed" };
  }
}

/**
 * Input: Roblox catalog ids. Output: a map from id to its square thumbnail URL. Ids Roblox has no
 * finished thumbnail for are left out, and a failed batch leaves its ids out instead of throwing.
 */
export async function fetchThumbnails(robloxAssetIds: string[], fetchImpl: typeof fetch = fetch): Promise<Map<string, string>> {
  const urls = new Map<string, string>();
  const unique = [...new Set(robloxAssetIds)];
  for (let i = 0; i < unique.length; i += THUMBNAIL_BATCH_SIZE) {
    const batch = unique.slice(i, i + THUMBNAIL_BATCH_SIZE);
    try {
      const res = await fetchImpl(`${THUMBNAILS_URL}?assetIds=${batch.join(",")}&size=${THUMBNAIL_SIZE}&format=Png`, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        next: { revalidate: THUMBNAIL_CACHE_SECONDS },
      } as RequestInit);
      if (!res.ok) continue;
      const data = await res.json();
      for (const row of data.data ?? []) {
        if (row.state === "Completed" && row.imageUrl) urls.set(String(row.targetId), row.imageUrl);
      }
    } catch {
      // The grid shows a blank square for these; the link under it still works.
    }
  }
  return urls;
}
