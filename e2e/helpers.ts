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
  // After an autosave the route refreshes and Next swaps <title>; wait for it (fails if a page has none).
  await expect(page).toHaveTitle(/\S/);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const summary = results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
  expect(summary).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** Row actions are buttons from 640 px and live in a "More for …" menu on phones. */
export async function rowAction(page: Page, item: string, action: string, desktopName: string) {
  const menu = page.getByRole("button", { name: `More for ${item}` });
  if (await menu.isVisible()) {
    await menu.click();
    const list = page.locator(`[id="${await menu.getAttribute("aria-controls")}"]`);
    await list.getByRole("button", { name: action, exact: true }).click();
  } else {
    await page.getByRole("button", { name: desktopName }).click();
  }
}
