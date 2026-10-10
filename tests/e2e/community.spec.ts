import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";

/**
 * Community UI (Engineer 4). Runs against a seeded database (npm run db:seed)
 * as a signed-out visitor, so it does not need a Clerk session.
 */

// Skip the first-visit market tour unless a test asks for it.
test.beforeEach(async ({ page }) => {
  // Accessibility scans and assertions run on settled content, not mid-animation.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    try {
      if (!location.search.includes("tour")) localStorage.setItem("senzi-tour-market-v1", "done");
    } catch {}
  });
});

/** Fails on serious or critical WCAG 2 A/AA violations. */
async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  expect(blocking, blocking.join("\n")).toEqual([]);
}

async function firstMarketHref(page: Page) {
  await page.goto("/markets");
  const link = page.locator("article h3 a").first();
  await expect(link).toBeVisible();
  return (await link.getAttribute("href"))!;
}

test.describe("pages", () => {
  test("homepage explains Senzi and lists open markets", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Forecast what startups do");
    await expect(page.getByRole("heading", { name: "Open markets" })).toBeVisible();
    await expect(page.getByText("Virtual credits only.").first()).toBeVisible();
    await expectAccessible(page);
  });

  test("markets filter by status chip and keep it in the URL", async ({ page }) => {
    await page.goto("/markets");
    await page.locator("label", { hasText: /^Resolved$/ }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/status=RESOLVED/);
    await expect(page.locator('input[name="status"][value="RESOLVED"]')).toBeChecked();
    await expectAccessible(page);
  });

  test("market detail labels each figure separately", async ({ page }) => {
    await page.goto(await firstMarketHref(page));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    for (const [target, label] of [
      ["allocation", "YES allocation"],
      ["calibrated", "Calibrated"],
      ["baseline", "Opening baseline"],
    ]) {
      await expect(page.locator(`[data-tour="${target}"]`)).toContainText(label);
    }
    await expect(page.getByRole("heading", { name: "Timeline" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Community allocation over time" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Share" })).toBeVisible();
    await expectAccessible(page);
  });

  test("signed-out visitors are asked to sign in before forecasting", async ({ page }) => {
    await page.goto(`${await firstMarketHref(page)}`);
    const panel = page.locator('section[aria-labelledby="forecast-heading"]');
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Sign in" }).or(panel.getByText(/closed to new forecasts/i)),
    ).toBeVisible();
  });

  test("first-visit tour walks through the three figures once", async ({ page }) => {
    const href = await firstMarketHref(page);
    await page.evaluate(() => localStorage.removeItem("senzi-tour-market-v1"));
    await page.goto(`${href}?tour=1`);
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Opening baseline" })).toBeVisible();
    await dialog.getByRole("button", { name: "Next" }).click();
    await expect(dialog.getByRole("heading", { name: "YES allocation" })).toBeVisible();
    await dialog.getByRole("button", { name: "Next" }).click();
    await dialog.getByRole("button", { name: "Got it" }).click();
    await expect(dialog).toBeHidden();
    await page.reload();
    await page.waitForTimeout(1500);
    await expect(page.getByRole("dialog")).toBeHidden();
  });

  test("startup directory and profile", async ({ page }) => {
    await page.goto("/startups");
    await expectAccessible(page);
    await page.locator("article h3 a").first().click();
    await expect(page).toHaveURL(/\/startups\/.+/);
    await expect(page.getByRole("heading", { name: "Details" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Public information" })).toBeVisible();
    // Metadata streams in after client navigation; scan once the title lands.
    await expect(page).toHaveTitle(/\S/);
    await expectAccessible(page);
  });

  test("news page filters by verification", async ({ page }) => {
    await page.goto("/news");
    await expect(page.getByRole("heading", { level: 1, name: "News" })).toBeVisible();
    await page.locator("label", { hasText: /^Verified$/ }).filter({ visible: true }).click();
    await expect(page).toHaveURL(/verification=verified/);
    await expectAccessible(page);
  });

  test("search shows a prompt, then results or an empty state", async ({ page }) => {
    await page.goto("/search");
    await expect(page.getByText("Search markets and startups").first()).toBeVisible();
    await page.getByRole("searchbox").fill("a");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page).toHaveURL(/q=a/);
    await expectAccessible(page);
  });

  test("unknown market shows not found", async ({ page }) => {
    await page.goto("/markets/does-not-exist-0000");
    await expect(page.getByText("Market not found")).toBeVisible();
  });
});

test.describe("market replay", () => {
  test("opens as a dialog, plays or explains missing history, and returns focus on Escape", async ({ page }) => {
    await page.goto(await firstMarketHref(page));
    const launcher = page.getByRole("button", { name: "Replay" });
    await launcher.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { level: 2 })).toBeVisible();

    const slider = dialog.getByRole("slider", { name: "Replay position" });
    const empty = dialog.getByText("Not enough history to replay yet.");
    await expect(slider.or(empty)).toBeVisible();
    await expect(dialog.getByText("NaN")).toHaveCount(0);

    if (await slider.isVisible()) {
      await expect(dialog.getByRole("button", { name: /^(Play|Replay from start)$/ })).toBeFocused();
      await slider.focus();
      await page.keyboard.press("Home");
      const first = await slider.getAttribute("aria-valuetext");
      await page.keyboard.press("End");
      expect(await slider.getAttribute("aria-valuetext")).not.toBe(first);
      await expect(dialog.getByRole("radio", { name: "1x" })).toHaveAttribute("aria-checked", "true");
    }
    await expectAccessible(page);

    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(launcher).toBeFocused();
  });
});

test.describe("app chrome", () => {
  test("Ctrl+K opens search, finds markets, and Escape closes it", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("Control+k");
    const dialog = page.getByRole("dialog", { name: "Search markets and startups" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("combobox").fill("se");
    await expect(dialog.getByRole("option").first()).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
  });

  test("theme toggle switches to dark and remembers it", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /^Theme:/ }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/\bdark\b/);
    await expectAccessible(page);
  });
});

test.describe("mobile", () => {
  const phone = devices["Pixel 7"];
  test.use({
    viewport: phone.viewport,
    userAgent: phone.userAgent,
    deviceScaleFactor: phone.deviceScaleFactor,
    isMobile: phone.isMobile,
    hasTouch: phone.hasTouch,
  });

  test("bottom tab bar replaces the top links", async ({ page }) => {
    await page.goto("/");
    const tabs = page.getByRole("navigation", { name: "Primary" });
    await expect(tabs).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Main" })).toBeHidden();
    await tabs.getByRole("link", { name: "Markets" }).click();
    await expect(page).toHaveURL(/\/markets/);
    await expect(tabs.getByRole("link", { name: "Markets" })).toHaveAttribute("aria-current", "page");
  });
});

test.describe("public API", () => {
  test("market listing never includes drafts or VC markets", async ({ request }) => {
    const response = await request.get("/api/markets?limit=100");
    expect(response.ok()).toBe(true);
    const body = await response.json();
    for (const market of body.data) {
      expect(["OPEN", "CLOSED", "RESOLVED", "CANCELLED"]).toContain(market.status);
      expect(market).not.toHaveProperty("visibility");
      expect(market).not.toHaveProperty("organizationId");
    }
    expect(body.meta).toHaveProperty("nextCursor");
  });

  test("replay history is normalized and carries no user data", async ({ request }) => {
    const listing = await (await request.get("/api/markets?limit=1")).json();
    const response = await request.get(`/api/markets/${listing.data[0].slug}/replay`);
    expect(response.ok()).toBe(true);
    const { data } = await response.json();
    expect(["real", "demo"]).toContain(data.source);
    expect(data.end).toBeGreaterThanOrEqual(data.start);
    for (const point of data.points) {
      expect(Object.keys(point).sort()).toEqual(["at", "credits", "forecasts", "general", "model", "verified"]);
    }
    expect(JSON.stringify(data)).not.toMatch(/userId|clerkId|email/);
    expect((await request.get("/api/markets/does-not-exist-0000/replay")).status()).toBe(404);
  });

  test("invalid filters are rejected with the shared error envelope", async ({ request }) => {
    const response = await request.get("/api/markets?status=DRAFT");
    expect(response.status()).toBe(400);
    expect((await response.json()).error.code).toBe("VALIDATION_ERROR");
  });
});
