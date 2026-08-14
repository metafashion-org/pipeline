import { request } from "@playwright/test";
import fs from "fs";
import { AUTH_DIR, E2E_ACCOUNTS } from "./fixtures";

// Logs in each seeded e2e personnel role through the real NextAuth REST endpoints (no browser UI):
// GET /api/auth/csrf for a csrf token, then POST /api/auth/callback/test-login with that token and
// the role's email. This exercises the real authorize()/signIn/jwt/session callbacks in
// web/app/api/auth/[...nextauth]/route.ts, gated on PLAYWRIGHT_TEST_LOGIN, and saves the resulting
// session cookie as per-role storageState for specs to reuse via test.use({ storageState: ... }).
export default async function globalSetup() {
  fs.mkdirSync(AUTH_DIR, { recursive: true });

  const baseURL = "http://localhost:3000";

  for (const account of E2E_ACCOUNTS) {
    const context = await request.newContext({ baseURL });

    const csrfResponse = await context.get("/api/auth/csrf");
    const { csrfToken } = await csrfResponse.json();

    await context.post("/api/auth/callback/test-login", {
      form: {
        email: account.email,
        csrfToken,
        callbackUrl: baseURL,
        json: "true",
      },
    });

    await context.storageState({ path: account.authFile });
    await context.dispose();
  }
}
