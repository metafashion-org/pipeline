import { SignInButton } from "@/components/SignInButton";

// Rendered per request because it reads the callbackUrl off the query string.
export const dynamic = "force-dynamic";

/**
 * The sign-in page.
 *
 * `callbackUrl` is where to land afterwards. It used to be hardcoded to /admin, so someone sent
 * here from a restricted form link signed in and arrived on a dashboard instead of the form they
 * were trying to open — and an artist, who cannot open /admin at all, was bounced twice before
 * landing anywhere. The default is now "/", which proxy.ts already routes to whatever this person
 * can actually use.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  const { callbackUrl } = await searchParams;

  // Only a path on this site is accepted. A full URL here would let a link sent to someone send
  // them off to another site immediately after they sign in.
  const safeCallback = callbackUrl && /^\/(?!\/)/.test(callbackUrl) ? callbackUrl : "/";

  return (
    <div className="grid min-h-dvh place-items-center bg-background text-foreground p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg grid place-items-center text-white font-bold bg-primary">M</div>
          <div>
            <p className="font-display font-semibold tracking-tight">MetaFashion</p>
            <p className="text-sm text-muted-foreground leading-tight">Pipeline</p>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5 space-y-4">
          <div className="space-y-1">
            <h1 className="text-xl">Sign in</h1>
            <p className="text-muted-foreground">Use the Google account your access was granted to.</p>
          </div>
          <SignInButton callbackUrl={safeCallback} />
        </div>

        <p className="text-sm text-muted-foreground text-center">
          Need access? Ask an admin, or fill in the artist access form at /apply.
        </p>
      </div>
    </div>
  );
}
