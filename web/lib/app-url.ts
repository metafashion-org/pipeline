/**
 * The site's own address, for links inside emails and Discord messages.
 *
 * NEXTAUTH_URL comes first because Google sign-in only works when it is the live domain, so it is
 * always kept correct; NEXT_PUBLIC_APP_URL was once left pointing at a single old deployment. Read
 * from process.env because modules that tests import can't use lib/env.ts, which throws when the
 * NextAuth variables are missing.
 *
 * Input: a path starting with "/". Output: the full URL.
 */
export function appUrl(path: string): string {
  const base = (process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");
  return `${base}${path}`;
}
