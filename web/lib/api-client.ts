// One place for "call our own API and find out what happened".
//
// This pattern was written out by hand in seventeen places across six components:
//
//   const res = await fetch(url, { method, headers, body });
//   const data = await res.json();
//   if (!res.ok) { toast.error(data.error || "..."); return; }
//
// which carries a real failure mode, not just repetition. res.json() runs BEFORE the status
// check, so any response that is not valid JSON throws there and the !res.ok branch never runs:
// a 500 HTML error page, a gateway timeout, a 502 from the platform, or the 429 the public form
// endpoint now returns. The caller's error toast never appears and the component dies on an
// unhandled rejection instead.
//
// Reading the body defensively and reporting the status is all it takes. The return shape mirrors
// what the call sites already do — check a flag, read the payload — so adopting it is a
// line-for-line swap rather than a control-flow rewrite.

export interface ApiResult<T> {
  ok: boolean;
  status: number;
  data: T & { error?: string };
}

/**
 * Calls a same-origin JSON API and reports the outcome without ever throwing on a bad response.
 *
 * Input: the URL, an HTTP method, and an optional body to send as JSON. Output: whether the request succeeded, its status code, and the parsed body — or, when the body was not JSON, an `error` string describing what came back instead.
 *
 * A network failure (offline, DNS, connection reset) is reported as ok:false with status 0, so a
 * caller only has to handle one shape.
 */
export async function apiCall<T = Record<string, unknown>>(
  url: string,
  options: { method?: string; body?: unknown; signal?: AbortSignal } = {}
): Promise<ApiResult<T>> {
  const { method = "GET", body, signal } = options;

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Network request failed";
    return { ok: false, status: 0, data: { error: message } as T & { error?: string } };
  }

  // Read as text first. Calling res.json() directly is what breaks on an HTML error page, and by
  // then the body is consumed and there is nothing left to report.
  const raw = await res.text().catch(() => "");
  let parsed: unknown = undefined;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
  }

  if (parsed === undefined) {
    // 204 and friends legitimately have no body; a failure with an unparseable body needs a
    // message the caller can actually show someone.
    const data = (res.ok ? {} : { error: `${res.status} ${res.statusText || "Request failed"}` }) as T & { error?: string };
    return { ok: res.ok, status: res.status, data };
  }

  return { ok: res.ok, status: res.status, data: parsed as T & { error?: string } };
}
