import { test, expect } from "@playwright/test";

// Confirms the public login page renders real content from the source (web/app/login/page.tsx) and throws no client-side exception.
// No auth is involved, no data is written.
test("login page renders without a client-side exception", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (err) => pageErrors.push(err));

  const response = await page.goto("/login");
  expect(response?.status()).toBe(200);

  await expect(page.getByText("Metafashion Tasks")).toBeVisible();
  await expect(page.getByText("Login to access the task management system.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Login with Google" })).toBeVisible();

  expect(pageErrors).toEqual([]);
});
