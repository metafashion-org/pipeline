import { test, expect } from "@playwright/test";

// Protected paths per the actual proxy matcher in web/proxy.ts: "/admin/:path*" and "/artist/:path*" require a session.
// With no session, next-auth's own `authorized` callback rejects the request before proxy's function body even runs, and next-auth redirects to the signIn page configured in web/app/api/auth/[...nextauth]/route.ts ("/login"), appending a callbackUrl query param.
// "/login" itself is in the matcher too but the authorized callback always returns true for it, so it must NOT redirect anywhere.

test("unauthenticated GET /admin redirects to /login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login\?/);
});

test("unauthenticated GET /artist redirects to /login", async ({ page }) => {
  await page.goto("/artist");
  await expect(page).toHaveURL(/\/login\?/);
});

test("unauthenticated GET /admin/board redirects to /login", async ({ page }) => {
  await page.goto("/admin/board");
  await expect(page).toHaveURL(/\/login\?/);
});

test("public /login is not redirected away", async ({ page }) => {
  await page.goto("/login");
  await expect(page).toHaveURL(/\/login$/);
});
