import Link from "next/link";
import { Search } from "lucide-react";

export default function NotFound() {
    return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-4 text-center">
            <div className="rounded-full bg-muted p-3">
                <Search className="h-6 w-6 text-muted-foreground" />
            </div>
            <h2 className="text-xl font-semibold text-foreground">
                Page not found
            </h2>
            <p className="max-w-md text-sm text-muted-foreground">
                The page you&apos;re looking for doesn&apos;t exist or has been
                moved.
            </p>
            <Link
                href="/login"
                className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:opacity-90"
            >
                Go to login
            </Link>
        </div>
    );
}
