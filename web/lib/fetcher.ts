/**
 * Fetches JSON for SWR, surfacing a failed request as a thrown error rather than resolving with the error body.
 * Without the status check a 401 or 500 resolves like a successful response, so callers render an error payload as if it were data, and a non-JSON error page throws an opaque parse error instead of a useful one.
 *
 * Input: the URL to fetch. Output: the parsed JSON body. Throws with the server's error message when the response is not ok.
 */
export async function jsonFetcher<T = unknown>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error || `Request failed with ${response.status}`);
  }
  return response.json();
}
