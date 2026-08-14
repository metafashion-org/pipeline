import { NextRequest, NextResponse } from "next/server";

// Server-side OG image fetcher — avoids browser CORS since this runs server-side.
// Tries og:image first, then twitter:image as fallback.
export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get("url");
    if (!url) {
        return NextResponse.json({ image: null });
    }

    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
            signal: AbortSignal.timeout(6000),
        });

        if (!res.ok) return NextResponse.json({ image: null });

        const html = await res.text();

        const image =
            html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1] ||
            html.match(/<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
            html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i)?.[1] ||
            null;

        return NextResponse.json({ image }, {
            headers: {
                "Cache-Control": "public, max-age=86400, stale-while-revalidate=3600",
            }
        });
    } catch {
        return NextResponse.json({ image: null });
    }
}
