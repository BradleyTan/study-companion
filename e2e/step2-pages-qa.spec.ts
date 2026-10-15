import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, rowAction, smallTargets, startDemo } from "./helpers";

// QA for flashcards.md "Long files: page ranges and series" (docs/qa/step-2-page-series.md).
// long-lecture.pdf and long-slides.pptx: 12 pages/slides of ~2,450 characters, 5 per set.

async function subjectWithFile(page: Page, subject: string, file: string, ready: string) {
  await startDemo(page);
  await createSubject(page, subject);
  await page.getByRole("link", { name: new RegExp(subject) }).click();
  await page.locator("#file-input").setInputFiles(path.join(__dirname, "fixtures", file));
  await expect(page.getByText(ready)).toBeVisible({ timeout: 20_000 });
}
const openMake = (page: Page, file: string) => rowAction(page, file, "Make flashcards", `Make flashcards from ${file}`);
const resultHeading = (page: Page) => page.locator("dialog[open]").getByRole("heading", { name: /new cards?!/ });

test("files that fit one set and notes show no page fields", async ({ page }) => {
  await subjectWithFile(page, "Anatomy", "heart.pdf", "Ready · 2 pages");
  await openMake(page, "heart.pdf");
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("button", { name: "Make flashcards" })).toBeVisible();
  await expect(dialog.getByLabel("First page")).toHaveCount(0);
  await expect(dialog.getByText("Making cards from the same text again is free.")).toBeVisible();
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId("series-progress")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: /Make the next set/ })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Start reviewing" })).toHaveClass(/btn-primary/);
});

test("PPTX: every string says slides; invalid ranges are caught on submit only", async ({ page }) => {
  await subjectWithFile(page, "Economics", "long-slides.pptx", "Ready · 12 slides");
  await openMake(page, "long-slides.pptx");
  const dialog = page.locator("dialog[open]");
  const first = dialog.getByLabel("First slide");
  const last = dialog.getByLabel("Last slide");
  const hint = dialog.getByTestId("range-hint");
  await expect(dialog.getByRole("group", { name: "Slides" })).toBeVisible();
  await expect(first).toHaveValue("1");
  await expect(last).toHaveValue("5");
  await expect(hint).toHaveText("Covers every passage on slides 1–5.");
  await expect(dialog.getByText("Each set of slides uses one go. Making cards from the same slides again is free.")).toBeVisible();

  const make = dialog.getByRole("button", { name: "Make flashcards" });
  // First slide 0: out of range, focus to the first field.
  await first.fill("0");
  await make.click();
  await expect(dialog.getByText("Pick a slide between 1 and 12.")).toBeVisible();
  await expect(first).toHaveAttribute("aria-invalid", "true");
  await expect(first).toBeFocused();
  // Backwards: re-fit on "First slide", then a smaller "Last slide" by hand.
  await first.fill("6");
  await expect(last).toHaveValue("10");
  await last.fill("3");
  await expect(dialog.getByText("The last slide comes before the first.")).toBeHidden();
  await make.click();
  await expect(dialog.getByText("The last slide comes before the first.")).toBeVisible();
  await expect(last).toBeFocused();
  // Not a number.
  await last.fill("");
  await make.click();
  await expect(dialog.getByText("Pick a slide between 1 and 12.")).toBeVisible();
  // One slide: singular copy.
  await first.fill("12");
  await expect(last).toHaveValue("12");
  await expect(hint).toHaveText("Covers every passage on slide 12.");

  await first.fill("1");
  await make.click();
  await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId("series-progress")).toContainText("Slides 1–5 of 12 done");
  await expect(dialog.getByRole("button", { name: "Make the next set: slides 6 to 10" })).toHaveText("Next: slides 6–10");
  await expectNoA11yViolations(page);
});

test("a series until the goes run out: last go, tomorrow hint, already, resume", async ({ page }) => {
  await subjectWithFile(page, "Cell biology", "long-lecture.pdf", "Ready · 12 pages");
  const dialog = page.locator("dialog[open]");
  const make = dialog.getByRole("button", { name: "Make flashcards" });
  const first = dialog.getByLabel("First page");
  const done = dialog.getByRole("button", { name: "Done" });

  // Three goes on pages 1–5 (each card count is a different request), then 6–10: one go left.
  for (const n of [10, 15, 20]) {
    await openMake(page, "long-lecture.pdf");
    await first.fill("1");
    await dialog.getByText(`About ${n}`).click();
    await make.click();
    await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
    await done.click();
  }
  await openMake(page, "long-lecture.pdf");
  await first.fill("6");
  await dialog.getByText("About 15").click();
  await make.click();
  await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId("series-progress")).toContainText("Pages 1–10 of 12 done");
  await expect(dialog.getByText("Uses your last go for today.")).toBeVisible();
  await done.click();

  // Pages 1–5 again with 10 cards: already made, free, offers the next pages.
  await openMake(page, "long-lecture.pdf");
  await expect(dialog.getByTestId("range-hint")).toContainText("Last time you got to page 10.");
  await first.fill("1");
  await dialog.getByText("About 10").click();
  await make.click();
  await expect(dialog.getByText("You already made cards from pages 1–5. Try the next pages or another source.")).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Make the next set: pages 6 to 10" }).click();
  await expect(first).toHaveValue("6");
  await expect(make).toBeFocused();
  // The last go: pages 6–10 with 10 cards. No Next button, the "tomorrow" hint instead.
  await make.click();
  await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId("quota-chip")).toHaveText("0 of 5 left today");
  await expect(dialog.getByText("That was today's last go. Pages 11–12 are next, tomorrow.")).toBeVisible();
  await expect(dialog.getByRole("button", { name: /Make the next set/ })).toHaveCount(0);
  await expect(dialog.getByRole("link", { name: "Start reviewing" })).toHaveClass(/btn-primary/);
  await expectNoHorizontalScroll(page);
  await done.click();

  // No goes left: the dialog opens on the limit message.
  await openMake(page, "long-lecture.pdf");
  await expect(dialog.getByText("You've made all 5 sets of flashcards for today.")).toBeVisible();
});

test("storage blocked: long files still default to the fitted range and make a set", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { get() { throw new Error("blocked"); }, configurable: true });
  });
  await subjectWithFile(page, "Genetics", "long-lecture.pdf", "Ready · 12 pages");
  await openMake(page, "long-lecture.pdf");
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByLabel("First page")).toHaveValue("1");
  await expect(dialog.getByLabel("Last page")).toHaveValue("5");
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId("series-progress")).toContainText("Pages 1–5 of 12 done");
});

test("dark mode and reduced motion: the series result passes axe", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await subjectWithFile(page, "Physics", "long-lecture.pdf", "Ready · 12 pages");
  await openMake(page, "long-lecture.pdf");
  const dialog = page.locator("dialog[open]");
  await dialog.getByLabel("Last page").fill("8");
  await expect(dialog.getByRole("button", { name: "Use pages 1–5" })).toBeVisible();
  await expectNoA11yViolations(page);
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId("series-progress")).toContainText("Pages 1–8 of 12 done (some passages sampled)");
  // No width animation under reduced motion.
  expect(await dialog.locator(".progress-fill").evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
  await expectNoA11yViolations(page);
});

test.describe("at 375 px on a touch screen", () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });

  test("page fields and the series result fit and have 44 px targets", async ({ page }) => {
    await subjectWithFile(page, "Chemistry", "long-lecture.pdf", "Ready · 12 pages");
    await openMake(page, "long-lecture.pdf");
    const dialog = page.locator("dialog[open]");
    await dialog.getByLabel("Last page").fill("8");
    await expect(dialog.getByRole("button", { name: "Use pages 1–5" })).toBeVisible();
    await expectNoHorizontalScroll(page);
    expect(await smallTargets(page)).toEqual([]);
    await dialog.getByRole("button", { name: "Use pages 1–5" }).click();
    await dialog.getByRole("button", { name: "Make flashcards" }).click();
    await expect(resultHeading(page)).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    expect(await smallTargets(page)).toEqual([]);
    // Phone order: Next on top, then Start reviewing, then Done, each full width.
    const next = await dialog.getByRole("button", { name: "Make the next set: pages 6 to 10" }).boundingBox();
    const review = await dialog.getByRole("link", { name: "Start reviewing" }).boundingBox();
    const done = await dialog.getByRole("button", { name: "Done" }).boundingBox();
    expect(next!.y).toBeLessThan(review!.y);
    expect(review!.y).toBeLessThan(done!.y);
    expect(Math.round(next!.width)).toBe(Math.round(done!.width));
  });
});
