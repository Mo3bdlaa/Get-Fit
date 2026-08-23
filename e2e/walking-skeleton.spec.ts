import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * R0's exit criterion, executed: register, log a set, see it on the chart.
 * If this passes, the vertical slice works end to end for a real user.
 */
test("a new user registers, logs a set, and sees it on the chart", async ({ page }) => {
  const email = `e2e-${randomUUID()}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Name").fill("E2E Trainee");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();

  // The first write of the run pays for migrations, so this one waits longer
  // than the default 5s.
  await expect(page).toHaveURL(/\/log$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Log a set" })).toBeVisible();

  await page.getByLabel("Weight (kg)").fill("100");
  await page.getByLabel("Reps").fill("5");
  await page.getByRole("button", { name: "Log set" }).click();

  await expect(page.getByText("Set logged.")).toBeVisible();
  const recent = page.locator(".set-list li").first();
  await expect(recent).toContainText("100");
  await expect(recent).toContainText("Set 1");

  await page.getByRole("link", { name: "Progress" }).click();
  await expect(page.getByRole("img", { name: "Training volume" })).toBeVisible();
  await expect(page.locator(".set-list li").first()).toContainText("500 kg");

  // The disclaimer is persistent, not a one-time modal (§8.3).
  await expect(page.getByText(/not medical advice/i)).toBeVisible();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // A signed-out visitor cannot reach the log screen.
  await page.goto("/log");
  await expect(page).toHaveURL(/\/login$/);
});

test("an Arabic account gets an RTL document and Arabic copy (NFR6)", async ({ page }) => {
  const email = `e2e-ar-${randomUUID()}@example.com`;

  await page.goto("/register");
  await page.getByLabel("Name").fill("متدرب");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByLabel("Language").selectOption("ar");
  await page.getByRole("button", { name: "Create account" }).click();

  await expect(page).toHaveURL(/\/log$/, { timeout: 30_000 });
  await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
  await expect(page.locator("html")).toHaveAttribute("lang", "ar");
  await expect(page.getByRole("heading", { name: "سجّل مجموعة" })).toBeVisible();
});
