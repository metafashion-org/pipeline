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
            <div className="rounded-full bg-red-100 p-3 dark:bg-red-900/30">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Something went wrong
            </h2>
            <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                An unexpected error occurred. Please try again or contact support
                if the problem persists.
            </p>
            <button
                onClick={reset}
                className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
                Try again
            </button>
        </div>
    );
}
