import { Button } from "@/components/ui/button";
import Link from "next/link";
import { ShieldAlert } from "lucide-react";

export default function UnauthorizedPage() {
  return (
    <div className="grid min-h-dvh place-items-center bg-background text-foreground p-6">
      <div className="w-full max-w-sm text-center space-y-4">
        <div className="mx-auto w-12 h-12 rounded-full grid place-items-center bg-muted">
          <ShieldAlert className="w-5 h-5 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl">No access</h1>
          <p className="text-muted-foreground">
            This account is not set up to use the pipeline, or its access has been turned off.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button asChild variant="outline">
            <Link href="/login">Sign in with another account</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/apply">Request artist access</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
