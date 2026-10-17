import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, rowAction, smallTargets, startDemo } from "./helpers";

// flashcards.md "Long files: page ranges and series" (2026-10-17): any pages up to 50, quick
// picks, Next keeps the chosen size, overlapping sets skip cards already in the deck.
// very-long-lecture.pdf: 60 pages of ~2,450 characters (5 fit one set); pages repeat every 14,
// so page 15 has page 1's points (e2e/fixtures/make-long-lecture.mjs).

async function subjectWithFile(page: Page, subject: string, file: string, ready: string) {
  await startDemo(page);
  await createSubject(page, subject);
  await page.getByRole("link", { name: new RegExp(subject) }).click();
  await page.locator("#file-input").setInputFiles(path.join(__dirname, "fixtures", file));
  await expect(page.getByText(ready)).toBeVisible({ timeout: 20_000 });
}
const openMake = (page: Page, file: string) => rowAction(page, file, "Make flashcards", `Make flashcards from ${file}`);
const resultHeading = (page: Page) => page.locator("dialog[open]").getByRole("heading", { name: /new cards?!/ });
const FILE = "very-long-lecture.pdf";

test("sequential sets of 20 pages: 1–20, then Next is 21–40", async ({ page }) => {
  await subjectWithFile(page, "Neuroscience", FILE, "Ready · 60 pages");
  await openMake(page, FILE);
  const dialog = page.locator("dialog[open]");
  const first = dialog.getByLabel("First page");
  const last = dialog.getByLabel("Last page");
  const hint = dialog.getByTestId("range-hint");
  const picks = dialog.getByRole("group", { name: "Quick pick for pages" });

  await expect(first).toHaveValue("1");
  await expect(last).toHaveValue("5");
  await expect(dialog.getByText("of 60")).toBeVisible();
  await expect(picks.getByRole("button")).toHaveText(["Best fit", "20 pages", "50 pages"]);
  await expect(picks.getByRole("button", { name: "Best fit: pages 1 to 5" })).toHaveAttribute("aria-pressed", "true");
  await expect(picks.getByRole("button", { name: "50 pages: pages 1 to 50" })).toBeVisible();

  await picks.getByRole("button", { name: "20 pages: pages 1 to 20" }).click();
  await expect(last).toHaveValue("20");
  await expect(picks.getByRole("button", { name: "20 pages: pages 1 to 20" })).toHaveAttribute("aria-pressed", "true");
  await expect(hint).toContainText("Cards will be spread across pages 1–20, a quick tour of the lot.");
  await expect(hint).toContainText("Want every passage?");
  await expect(dialog.getByRole("button", { name: "Use pages 1–5" })).toBeVisible();
  await expect(dialog.getByText("Each set of pages uses one go, however many pages.", { exact: false })).toBeVisible();
  // Changing the first page keeps the pressed pick's size.
  await first.fill("3");
  await expect(last).toHaveValue("22");
  await first.fill("1");
  await expect(last).toHaveValue("20");
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);

  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId("series-progress")).toHaveText("Pages 1–20 of 60 done (some passages sampled)");
  await expect(dialog.getByText(/Skipped \d+ cards? you already have\./)).toHaveCount(0);
  const next = dialog.getByRole("button", { name: "Make the next set: pages 21 to 40" });
  await expect(next).toHaveText("Next: pages 21–40");
  await next.click();

  // Step 1 again, prefilled with the same size and "20 pages" pressed, one press away.
  await expect(first).toHaveValue("21");
  await expect(last).toHaveValue("40");
  await expect(picks.getByRole("button", { name: "20 pages: pages 21 to 40" })).toHaveAttribute("aria-pressed", "true");
  await expect(hint).toContainText("You've made cards from pages 1–20 so far.");
  await expect(dialog.getByRole("button", { name: "Make flashcards" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId("series-progress")).toHaveText("Pages 1–40 of 60 done (some passages sampled)");
  await expect(dialog.getByRole("button", { name: "Make the next set: pages 41 to 60" })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith("studynest:cardRanges:"))!))).toBe("[[1,40]]");

  // Next visit starts at the first page not made yet.
  await dialog.getByRole("button", { name: "Done" }).click();
  await openMake(page, FILE);
  await expect(first).toHaveValue("41");
  await expect(last).toHaveValue("45");
});

test("overlapping sets: 1–20 then 15–34 skips cards already in the deck", async ({ page }) => {
  await subjectWithFile(page, "Physiology", FILE, "Ready · 60 pages");
  await openMake(page, FILE);
  const dialog = page.locator("dialog[open]");
  const first = dialog.getByLabel("First page");
  const last = dialog.getByLabel("Last page");
  const hint = dialog.getByTestId("range-hint");
  const picks = dialog.getByRole("group", { name: "Quick pick for pages" });

  await picks.getByRole("button", { name: "20 pages: pages 1 to 20" }).click();
  await dialog.getByText("About 15").click();
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Done" }).click();

  // Pages 15–34 repeat pages 1–20's points (the fixture repeats every 14 pages).
  await openMake(page, FILE);
  await expect(hint).toContainText("You've made cards from pages 1–20 so far.");
  await expect(first).toHaveValue("21");
  await first.fill("15");
  await last.fill("34");
  await expect(hint).toContainText("Cards you already have will be skipped.");
  await expect(picks.getByRole("button", { name: "20 pages: pages 15 to 34" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByText("About 15").click();
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText(/^Skipped \d+ cards? you already have\.$/)).toBeVisible();
  await expect(dialog.getByText(/Your notes had enough for/)).toHaveCount(0);
  await expect(dialog.getByTestId("series-progress")).toHaveText("Pages 1–34 of 60 done (some passages sampled)");
  // Next continues from the end of this set, same size.
  await expect(dialog.getByRole("button", { name: "Make the next set: pages 35 to 54" })).toBeVisible();
  await expectNoA11yViolations(page);
  await dialog.getByRole("button", { name: "Done" }).click();

  // Pages 1–20 with 10 cards: the first 10 of the 15 already made, so nothing new.
  await openMake(page, FILE);
  await first.fill("1");
  await last.fill("20");
  await dialog.getByText("About 10").click();
  await expect(hint).toContainText("You've made cards from these pages before. Cards you already have will be skipped.");
  const before = await dialog.getByTestId("quota-chip").textContent();
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(dialog.getByText("Every card from pages 1–20 is already in your deck. Try some new pages. This one didn't use up a go.")).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByRole("button", { name: "Make the next set: pages 21 to 40" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
  await expect(dialog.getByTestId("quota-chip")).toHaveText(before!);
  await expectNoA11yViolations(page);
});

test("up to 50 pages at a time; a 50-page set is one go", async ({ page }) => {
  await subjectWithFile(page, "Pharmacology", FILE, "Ready · 60 pages");
  await openMake(page, FILE);
  const dialog = page.locator("dialog[open]");
  const last = dialog.getByLabel("Last page");
  const make = dialog.getByRole("button", { name: "Make flashcards" });

  await last.fill("51");
  await expect(dialog.getByText("Up to 50 pages at a time.")).toBeHidden();
  await make.click();
  await expect(dialog.getByText("Up to 50 pages at a time.")).toBeVisible();
  await expect(last).toHaveAttribute("aria-invalid", "true");
  await expect(last).toBeFocused();

  await dialog.getByRole("button", { name: "50 pages: pages 1 to 50" }).click();
  await expect(last).toHaveValue("50");
  await expect(dialog.getByText("Up to 50 pages at a time.")).toBeHidden();
  await make.click();
  await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId("series-progress")).toHaveText("Pages 1–50 of 60 done (some passages sampled)");
  await expect(dialog.getByTestId("quota-chip")).toHaveText("14 of 15 left today");
  await expect(dialog.getByRole("button", { name: "Make the next set: pages 51 to 60" })).toBeVisible();
});

test("old storage key is read once as pages 1 to n", async ({ page }) => {
  await subjectWithFile(page, "Histology", FILE, "Ready · 60 pages");
  // Find the file's id from the stored coverage after one set, then fake the old format.
  await openMake(page, FILE);
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith("studynest:cardRanges:"))!;
    localStorage.removeItem(key);
    localStorage.setItem(key.replace("cardRanges", "cardRange"), "12");
  });
  await openMake(page, FILE);
  await expect(dialog.getByLabel("First page")).toHaveValue("13");
  await expect(dialog.getByTestId("range-hint")).toContainText("You've made cards from pages 1–12 so far.");
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("studynest:cardRange")).map((k) => [k.split(":")[1], localStorage.getItem(k)]));
  expect(keys).toEqual([["cardRanges", "[[1,12]]"]]);
});

test("a file that fits one set can still choose pages", async ({ page }) => {
  await subjectWithFile(page, "Anatomy", "heart.pdf", "Ready · 2 pages");
  await openMake(page, "heart.pdf");
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByLabel("First page")).toHaveCount(0);
  const choose = dialog.getByRole("button", { name: "Choose pages" });
  await choose.click();
  await expect(dialog.getByLabel("First page")).toHaveValue("1");
  await expect(dialog.getByLabel("Last page")).toHaveValue("2");
  await expect(dialog.getByRole("group", { name: "Quick pick for pages" })).toHaveCount(0);
  await dialog.getByRole("button", { name: "Use the whole file" }).click();
  await expect(dialog.getByLabel("First page")).toHaveCount(0);
  await expect(dialog.getByText("Making cards from the same text again is free.")).toBeVisible();
});

test.describe("at 375 px on a touch screen", () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });

  test("quick picks fit on one line with 44 px targets", async ({ page }) => {
    await subjectWithFile(page, "Chemistry", FILE, "Ready · 60 pages");
    await openMake(page, FILE);
    const dialog = page.locator("dialog[open]");
    const buttons = dialog.getByRole("group", { name: "Quick pick for pages" }).getByRole("button");
    await expect(buttons).toHaveCount(3);
    const boxes = await Promise.all([0, 1, 2].map((i) => buttons.nth(i).boundingBox()));
    expect(new Set(boxes.map((b) => Math.round(b!.y))).size).toBe(1);
    await expectNoHorizontalScroll(page);
    expect(await smallTargets(page)).toEqual([]);
  });
});
