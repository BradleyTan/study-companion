import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function startDemo(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Try the demo" }).click();
  await expect(page).toHaveURL(/\/subjects$/);
}

export async function createSubject(page: Page, name: string, opts: { emoji?: string } = {}) {
  const empty = page.getByRole("button", { name: "Create your first subject" });
  const add = page.getByRole("button", { name: "+ New subject" });
  // Wait for the list to render: an isVisible() snapshot taken while the page is still
  // loading picked the wrong button under load (intermittent mobile failures).
  await expect(empty.or(add).filter({ visible: true }).first()).toBeVisible();
  if (await empty.isVisible()) await empty.click();
  else await add.click();
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
  const direct = page.getByRole("button", { name: desktopName });
  await expect(menu.or(direct).filter({ visible: true }).first()).toBeVisible();
  if (await menu.isVisible()) {
    await menu.click();
    const list = page.locator(`[id="${await menu.getAttribute("aria-controls")}"]`);
    await list.getByRole("button", { name: action, exact: true }).click();
  } else {
    await direct.click();
  }
}

/** Controls under 44 × 44 px (inputs only need the height), for touch-screen checks. */
export async function smallTargets(page: Page) {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>("button, a[href], select, input:not([type=hidden]), [role=button], [role=treeitem]")) {
      const r = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      if (!r.width || !r.height || style.visibility === "hidden" || el.closest("[aria-hidden=true], .sr-only, .react-flow__attribution")) continue;
      if (el.tagName === "A" && style.display === "inline") continue;
      if (r.height < 44 || (r.width < 44 && el.tagName !== "INPUT")) out.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 30)}" ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  });
}
