import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function startDemo(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page).toHaveURL(/\/subjects$/);
}

export async function createSubject(page: Page, name: string, opts: { emoji?: string } = {}) {
  const empty = page.getByRole("button", { name: "Create your first subject" });
  if (await empty.isVisible()) await empty.click();
  else await page.getByRole("button", { name: "+ New subject" }).click();
  const dialog = page.getByRole("dialog", { name: "New subject" });
  await dialog.getByLabel("Name").fill(name);
  await dialog.getByRole("radio", { name: "mint" }).check({ force: true });
  if (opts.emoji) await dialog.getByRole("radio", { name: opts.emoji }).check({ force: true });
  await dialog.getByRole("button", { name: "Create subject" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible();
}

export async function expectNoA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(summary).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}
