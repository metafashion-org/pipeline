import { defineConfig, devices } from "@playwright/test";

// Runs against a real running instance of the app, never a mock.
// The webServer block builds and starts the production server (closer to reality than `next dev`) and reuses one that's already running locally so repeat runs during development are fast.

// The e2e suite must only ever touch a throwaway local database, never the live Supabase project configured in .env.local.
// Bring the database up first with `pnpm run test:db:up`, or point E2E_DATABASE_URL at another local one.
const TEST_DATABASE_URL =
  process.env.E2E_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/metafashion_test";

// Second, independent layer of the same protection as scripts/assert-local-db.mjs: refuse to start at all if the resolved database host is not local, so an inherited or mistyped DATABASE_URL cannot silently run mutating specs against production data.
const databaseHost = new URL(TEST_DATABASE_URL).hostname;
if (databaseHost !== "localhost" && databaseHost !== "127.0.0.1") {
  throw new Error(
    `Refusing to run e2e tests against non-local database host "${databaseHost}". The suite mutates data and must only ever run against a throwaway local database.`,
  );
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  reporter: [["list"], ["html"]],
  timeout: 30_000,
  globalSetup: "./tests/global-setup.ts",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    // Read-only specs, safe to run concurrently.
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: "**/mutating/**",
    },
    // Specs that write to the database, serialized so they cannot race each other over shared rows.
    {
      name: "mutating",
      use: { ...devices["Desktop Chrome"] },
      testMatch: "**/mutating/**/*.spec.ts",
      fullyParallel: false,
    },
  ],
  webServer: {
    command: "pnpm run build && pnpm run start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: {
      DATABASE_URL: TEST_DATABASE_URL,
      // Next's CLI defaults NODE_ENV to "production" for both `build` and `start`, which would leave the test-login provider gated off during our own test run.
      NODE_ENV: "test",
      PLAYWRIGHT_TEST_LOGIN: "true",
    },
  },
});
