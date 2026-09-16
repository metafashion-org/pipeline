"use client";

import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/button";

/**
 * Clears the current NextAuth session and lands back on /login.
 *
 * Input: none. Output: the button.
 * Needed on /unauthorized specifically: a rejected sign-in still leaves a real NextAuth session
 * cookie in place (the session callback empties roles/capabilities but can't return "no session"),
 * so someone stuck there had no way to actually clear it and start over — only "Sign in with
 * another account", which re-authorizes without ever signing out first.
 */
export function SignOutButton() {
  return (
    <Button variant="ghost" className="w-full" onClick={() => signOut({ callbackUrl: "/login" })}>
      Sign out
    </Button>
  );
}
