// Scoped to the authenticated shell rather than sitting at app/loading.tsx.
//
// A loading.tsx at the app root wraps EVERY route in a Suspense boundary, which makes Next flush
// the response shell — and its 200 status — before any page body runs. notFound() then arrives
// too late to set the status, so every not-found page in the app answered 200 while looking like
// a 404. Uptime checks and crawlers saw a healthy page for a missing one.
//
// These are the pages the spinner is actually for: the admin board, curation, publisher and
// archive all do real database work before they can render. The public form route and the
// not-found path do not, and they get correct status codes back by not being wrapped.
import { Loader2 } from "lucide-react";

export default function Loading() {
    return (
        <div className="flex flex-col h-screen bg-background">
            <main className="flex-1 flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 text-muted-foreground">
                    <Loader2 className="h-8 w-8 animate-spin" />
                    <p className="text-sm font-medium">Loading…</p>
                </div>
            </main>
        </div>
    );
}
