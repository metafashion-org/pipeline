import { test, expect } from "@playwright/test";

// Every route below is GET-only and side-effect free (read queries), and each one's handler in web/app/api/** checks getServerSession() before doing anything else and returns 401 with no session.
// No POST/PATCH/DELETE endpoint is called here.
const protectedGetRoutes = [
  "/api/admin/curation-fields",
  "/api/admin/forms",
  "/api/admin/forms/nonexistent-form-id",
  "/api/admin/personnel",
  "/api/admin/statuses",
  "/api/admin/transition-rules",
  "/api/assets",
  "/api/assets/nonexistent-sku/image",
];

for (const route of protectedGetRoutes) {
  test(`unauthenticated GET ${route} returns 401`, async ({ request }) => {
    const res = await request.get(route);
    expect(res.status()).toBe(401);
    expect(res.status()).not.toBe(200);
  });
}
