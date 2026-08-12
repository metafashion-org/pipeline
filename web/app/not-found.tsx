import Link from "next/link";
import { Search } from "lucide-react";

export default function NotFound() {
    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
            <div className="rounded-full bg-zinc-100 p-3 dark:bg-zinc-800">
                <Search className="h-6 w-6 text-zinc-500 dark:text-zinc-400" />
            </div>
            <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
                Page not found
            </h2>
            <p className="max-w-md text-sm text-zinc-500 dark:text-zinc-400">
                The page you&apos;re looking for doesn&apos;t exist or has been
                moved.
            </p>
            <Link
                href="/login"
                className="mt-2 rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
                Go to login
            </Link>
        </div>
    );
}
