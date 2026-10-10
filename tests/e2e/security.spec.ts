import { expect, test } from "@playwright/test";

// Signed-out visitors must never get private or admin data.

const protectedApis = [
  "/api/users/me",
  "/api/users/me/credits",
  "/api/organizations",
  "/api/admin/markets",
  "/api/admin/users",
  "/api/admin/audit-logs",
];

for (const path of protectedApis) {
  test(`GET ${path} returns 401 JSON when signed out`, async ({ request }) => {
    const res = await request.get(path);
    expect(res.status()).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHENTICATED");
  });
}

test("admin mutations are rejected when signed out", async ({ request }) => {
  const res = await request.post("/api/admin/credits", {
    data: { userId: "x", amount: 1000, type: "ADMIN_GRANT", memo: "nope", idempotencyKey: "e2e-attempt-1" },
  });
  expect(res.status()).toBe(401);
});

test("cron endpoint needs the secret", async ({ request }) => {
  const res = await request.get("/api/admin/cron/close-markets");
  expect(res.status()).toBe(401);
});

test("admin pages send signed-out visitors to sign in", async ({ page }) => {
  const response = await page.goto("/admin");
  expect(page.url()).not.toMatch(/\/admin$/);
  expect(response?.status()).toBeLessThan(500);
});
