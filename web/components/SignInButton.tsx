"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";

/**
 * Starts the Google sign-in flow.
 *
 * Input: where to send the person once they are signed in. Output: the button.
 * Split out of the page so the page can stay a server component and read the callbackUrl off the
 * request rather than out of the browser after mount.
 */
export function SignInButton({ callbackUrl }: { callbackUrl: string }) {
  const [loading, setLoading] = useState(false);

  return (
    <Button
      className="w-full"
      size="lg"
      disabled={loading}
      onClick={() => {
        setLoading(true);
        // No catch that clears `loading`: this navigates away, and re-enabling the button on the
        // page being torn down invites a second sign-in attempt mid-redirect.
        signIn("google", { callbackUrl });
      }}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {loading ? "Opening Google" : "Continue with Google"}
    </Button>
  );
}
