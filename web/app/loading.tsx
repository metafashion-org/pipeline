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
