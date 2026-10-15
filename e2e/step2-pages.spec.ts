import path from "node:path";
import { expect, test } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, rowAction, startDemo } from "./helpers";

// flashcards.md "Long files: page ranges and series". long-lecture.pdf has 12 pages of ~2,450
// characters (e2e/fixtures/make-long-lecture.mjs), so one set covers 5 pages: 1–5, 6–10, 11–12.
test("a long lecture file becomes a series of flashcard sets", async ({ page }) => {
  await startDemo(page);
  await createSubject(page, "Cell biology");
  await page.getByRole("link", { name: /Cell biology/ }).click();
  await page.locator("#file-input").setInputFiles(path.join(__dirname, "fixtures", "long-lecture.pdf"));
  await expect(page.getByText("Ready · 12 pages")).toBeVisible({ timeout: 20_000 });
  await rowAction(page, "long-lecture.pdf", "Make flashcards", "Make flashcards from long-lecture.pdf");

  const dialog = page.locator("dialog[open]");
  const first = dialog.getByLabel("First page");
  const last = dialog.getByLabel("Last page");
  const hint = dialog.getByTestId("range-hint");
  await expect(first).toHaveValue("1");
  await expect(last).toHaveValue("5");
  await expect(dialog.getByText("of 12")).toBeVisible();
  await expect(hint).toHaveText("Covers every passage on pages 1–5.");
  await expect(dialog.getByText("Each set of pages uses one go. Making cards from the same pages again is free.")).toBeVisible();

  // Too many pages for one set: sampled, with a button that snaps back to the fit.
  await last.fill("8");
  await expect(hint).toContainText("Long range: cards will come from across pages 1–8. Pick fewer pages to cover every passage.");
  await dialog.getByRole("button", { name: "Use pages 1–5" }).click();
  await expect(last).toHaveValue("5");

  // Validation only on submit; focus goes to the bad field.
  await last.fill("30");
  await expect(dialog.getByText("Pick a page between 1 and 12.")).toBeHidden();
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(dialog.getByText("Pick a page between 1 and 12.")).toBeVisible();
  await expect(last).toHaveAttribute("aria-invalid", "true");
  await expect(last).toBeFocused();
  await last.fill("5");
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);

  // Set 1.
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(dialog.getByRole("heading", { name: /new cards?!/ })).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId("series-progress")).toContainText("Pages 1–5 of 12 done");
  await expect(dialog.getByText("Uses 1 of your 4 goes left today.")).toBeVisible();
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);

  // Set 2 via "Next": Step 1 again, prefilled, one press away.
  await dialog.getByRole("button", { name: "Make the next set: pages 6 to 10" }).click();
  await expect(dialog.getByText("From long-lecture.pdf.")).toBeVisible();
  await expect(first).toHaveValue("6");
  await expect(last).toHaveValue("10");
  await expect(dialog.getByRole("button", { name: "Make flashcards" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("heading", { name: /new cards?!/ })).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId("series-progress")).toContainText("Pages 1–10 of 12 done");
  await expect(dialog.getByRole("button", { name: "Make the next set: pages 11 to 12" })).toBeVisible();
  await expect(dialog.getByTestId("quota-chip")).toHaveText("3 of 5 left today");
  expect(await page.evaluate(() => localStorage.getItem(Object.keys(localStorage).find((k) => k.startsWith("studynest:cardRange:"))!))).toBe("10");

  // Next visit starts after the furthest page made.
  await dialog.getByRole("button", { name: "Done" }).click();
  await rowAction(page, "long-lecture.pdf", "Make flashcards", "Make flashcards from long-lecture.pdf");
  await expect(first).toHaveValue("11");
  await expect(last).toHaveValue("12");
  await expect(hint).toContainText("Last time you got to page 10.");
});
