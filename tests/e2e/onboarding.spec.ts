import AxeBuilder from "@axe-core/playwright";
import { devices, expect, test, type Page } from "@playwright/test";

/** Homepage, /how-it-works tutorial and /profile as a signed-out visitor. */

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
});

async function expectAccessible(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa"]).analyze();
  const blocking = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`);
  expect(blocking, blocking.join("\n")).toEqual([]);
}

const popup = (page: Page) => page.getByRole("dialog");
const next = (page: Page) => popup(page).getByRole("button", { name: "Next", exact: true });

async function expectStep(page: Page, n: number, title: string) {
  await expect(popup(page)).toContainText(`Step ${n} of 9`);
  await expect(popup(page).getByRole("heading", { name: title })).toBeVisible();
}

test("hero sample reacts to your estimate", async ({ page }) => {
  await page.goto("/");
  const slider = page.getByLabel("Your estimate that YES happens");
  // Retry until the page has hydrated and reacts to input.
  await expect(async () => {
    await slider.fill("50");
    await slider.fill("95");
    await expect(page.getByText(/more optimistic than the market\. On Senzi, you'd buy YES/)).toBeVisible({ timeout: 1000 });
  }).toPass();
  await page.getByRole("button", { name: "NO", exact: true }).click();
  await expect(page.getByText(/That points to YES, not NO/)).toBeVisible();
  await slider.fill("5");
  await expect(page.getByText(/more skeptical than the market\. On Senzi, you'd buy NO/)).toBeVisible();
  await expectAccessible(page);
});

test("navbar opens the tutorial page", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "How it works" }).click();
  await expect(page).toHaveURL(/\/how-it-works$/);
  await expect(page.getByRole("heading", { name: "Learn Senzi by doing it" })).toBeVisible();
  await expectAccessible(page);
});

test("guided walkthrough runs start to finish without real API calls", async ({ page }) => {
  const posts: string[] = [];
  page.on("request", (req) => {
    if (req.method() !== "GET" && req.url().includes("/api/")) posts.push(req.url());
  });

  await page.goto("/how-it-works");
  await page.getByRole("button", { name: "Start the walkthrough" }).click();

  await expectStep(page, 1, "Welcome to Senzi");
  await expect(popup(page).getByRole("button", { name: "Back" })).toBeDisabled();
  await expectAccessible(page);
  await next(page).click();

  await expectStep(page, 2, "Read the question");
  await expect(next(page)).toBeDisabled();
  await page.getByRole("button", { name: "How it resolves" }).click();
  await next(page).click();

  await expectStep(page, 3, "Explore the market");
  await popup(page).getByRole("button", { name: "Back" }).click();
  await expectStep(page, 2, "Read the question");
  await next(page).click();
  await next(page).click();

  await expectStep(page, 4, "Make a forecast");
  await page.getByRole("button", { name: "YES", exact: true }).click();
  await page.getByLabel("How likely is YES?").fill("70");
  await expect(popup(page)).toContainText("Buying YES matches that view.");
  await next(page).click();

  await expectStep(page, 5, "Use practice credits");
  await page.getByRole("textbox", { name: "Practice credits" }).fill("abc");
  await expect(page.getByText(/whole number/i)).toBeVisible();
  await page.getByRole("textbox", { name: "Practice credits" }).fill("50");
  await page.getByRole("button", { name: "Place practice forecast" }).click();
  await expect(page.getByText("Practice balance 450 credits")).toBeVisible();
  await next(page).click();

  await expectStep(page, 6, "Review your forecast");
  await expect(page.getByText(/50 on YES/)).toBeVisible();
  await expect(popup(page)).toContainText(/more (optimistic|skeptical) than the market|about the same/);
  await next(page).click();
  await expectStep(page, 7, "Watch it evolve");
  await next(page).click();

  await expectStep(page, 8, "See the outcome");
  await page.getByRole("button", { name: "Fast-forward to the deadline" }).click();
  await expect(page.getByText(/You spent 50 practice credits/)).toBeVisible();
  await next(page).click();

  await expect(page.getByRole("heading", { name: "You've got it" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Explore real markets" })).toBeVisible();
  await expectAccessible(page);
  expect(posts).toEqual([]);

  // Finished visitors see "Replay" next time.
  await page.goto("/how-it-works");
  await expect(page.getByRole("button", { name: "Replay the walkthrough" })).toBeVisible();
});

test("skip, restart and exit", async ({ page }) => {
  await page.goto("/how-it-works");
  await page.getByRole("button", { name: "Start the walkthrough" }).click();
  await next(page).click();
  await popup(page).getByRole("button", { name: "Skip" }).click();
  await expectStep(page, 3, "Explore the market");
  await page.getByRole("button", { name: "Restart walkthrough" }).click();
  await expectStep(page, 1, "Welcome to Senzi");
  await page.keyboard.press("Escape");
  await expect(popup(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Learn Senzi by doing it" })).toBeVisible();
});

test("practice mode trades freely and resets", async ({ page }) => {
  await page.goto("/how-it-works#practice");
  await expect(page.getByText("Experiment freely.")).toBeVisible();
  await expect(popup(page)).toHaveCount(0);
  await page.getByRole("button", { name: "NO", exact: true }).click();
  await page.getByRole("textbox", { name: "Practice credits" }).fill("100");
  await page.getByRole("button", { name: "Place practice forecast" }).click();
  await expect(page.getByText("Practice balance 400 credits")).toBeVisible();
  await page.getByRole("button", { name: "Reset" }).click();
  await expect(page.getByText("Practice balance 500 credits")).toBeVisible();
  await expectAccessible(page);
});

test("returning visitors can pick up where they left off", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("senzi-tutorial-v1", JSON.stringify({ step: 3, completed: false }));
  });
  await page.goto("/");
  await expect(page.getByText("Welcome back:")).toBeVisible();
  await page.getByRole("link", { name: "Continue tutorial (step 4)" }).click();
  await page.getByRole("button", { name: "Continue from step 4" }).click();
  await expectStep(page, 4, "Make a forecast");
});

test("first-time visitors get a light choice they can dismiss", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("New here?")).toBeVisible();
  await page.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByText("Welcome back:")).toBeVisible();
});

test("profile asks signed-out visitors to sign in", async ({ page }) => {
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: "Your profile" })).toBeVisible();
  await expect(page.getByText("Sign in to see your virtual credits")).toBeVisible();
  await expectAccessible(page);
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

  test("walkthrough popup sits above the bottom nav", async ({ page }) => {
    await page.goto("/how-it-works");
    await page.getByRole("button", { name: "Start the walkthrough" }).click();
    await expect(popup(page)).toBeInViewport();
    const pop = (await popup(page).boundingBox())!;
    const nav = (await page.getByRole("navigation", { name: "Primary" }).boundingBox())!;
    expect(pop.y + pop.height).toBeLessThanOrEqual(nav.y + 1);
    await expectAccessible(page);
  });
});
