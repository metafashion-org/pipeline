"use client";

import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";

export default function GlobalError({
    error,
    reset,
}: {
    error: Error & { digest?: string }
    reset: () => void
}) {
    useEffect(() => {
        console.error("Unhandled error:", error);
    }, [error]);

    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
            <div className="rounded-full bg-destructive/10 p-3">
                <AlertTriangle className="h-6 w-6 text-destructive" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
                Something went wrong
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
                An unexpected error occurred. Please try again or contact support
                if the problem persists.
            </p>
            <button
                onClick={reset}
                className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
                Try again
            </button>
        </div>
    );
}
