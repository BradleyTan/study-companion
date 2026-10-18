import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, rowAction, startDemo } from "./helpers";

// QA for Step 3 (docs/qa/step-3.md): dark mode with reduced motion on every new screen, answers
// that never reach the browser before they are checked, and HTML in a note that never becomes
// markup in a chat answer or citation preview.
const TITLE = "Cell structure";
const NOTE = [
  "The mitochondria is the organelle that makes energy for the cell through respiration.",
  "Ribosomes are small structures that build proteins from amino acids.",
  "The nucleus contains the genetic material of the cell and controls its activity.",
  "Photosynthesis means turning light energy into chemical energy inside chloroplasts.",
  "Osmosis is the movement of water across a partially permeable membrane.",
].join(" ");

async function subjectWithNote(page: Page, subject: string, text = NOTE) {
  await startDemo(page);
  await createSubject(page, subject);
  await page.getByRole("link", { name: new RegExp(subject) }).click();
  await page.getByRole("button", { name: "+ Write a note" }).click();
  await expect(page).toHaveURL(/\/notes\//);
  await page.getByLabel("Title").fill(TITLE);
  await page.getByRole("textbox", { name: "Note text" }).click();
  await page.keyboard.insertText(text);
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
  await page.getByRole("link", { name: `← Back to ${subject}` }).click();
  await expect(page).toHaveURL(/\/subjects\/[^/]+$/);
}

async function makeQuiz(page: Page) {
  await rowAction(page, TITLE, "Make a quiz", `Make a quiz from ${TITLE}`);
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("radiogroup", { name: "How many questions" }).getByText("5", { exact: true }).click();
  await dialog.getByRole("button", { name: "Make quiz" }).click();
  await expect(dialog.getByRole("heading", { name: /^Quiz ready! \d+ questions?$/ })).toBeVisible({ timeout: 15_000 });
  return dialog;
}

test("dark mode and reduced motion: quizzes, a question, results, weak topics and chat pass axe", async ({ page }) => {
  test.slow();
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await subjectWithNote(page, "Botany");
  const dialog = await makeQuiz(page);
  await expectNoA11yViolations(page);
  await dialog.getByRole("link", { name: "Start quiz" }).click();

  const q = page.getByTestId("question");
  await expect(q).toBeVisible();
  await expectNoA11yViolations(page);
  // Every question answered with "I don't know": misses that make weak topics.
  for (;;) {
    await page.getByTestId("question").getByRole("button", { name: "I don't know" }).click();
    const fb = page.getByTestId("feedback");
    await expect(fb).toBeVisible();
    await expect(fb.getByRole("heading", { name: "No worries. Here's the answer." })).toBeVisible();
    // Reduced motion: no shake, no burst of paper bits.
    expect(await page.locator("[data-testid=burst], .burst").count()).toBe(0);
    const next = fb.getByRole("button", { name: /^(Next question|See results)$/ });
    const last = (await next.textContent()) === "See results";
    if (last) await expectNoA11yViolations(page);
    await next.click();
    if (last) break;
  }
  await expect(page.getByText(/You scored|Good practice\./).first()).toBeVisible();
  await expectNoA11yViolations(page);

  const subjectUrl = page.url().replace(/\/quizzes\/.*$/, "");
  await page.goto(`${subjectUrl}/weak-topics`);
  await expect(page.getByRole("heading", { name: "Weak topics" })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto(`${subjectUrl}/quizzes`);
  await expect(page.getByRole("heading", { name: "Quizzes", exact: true })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto(subjectUrl);
  await expect(page.getByRole("link", { name: /^Quizzes/ })).toBeVisible();
  await expectNoA11yViolations(page);

  await page.goto(`${subjectUrl}/ask`);
  await page.getByRole("textbox", { name: "Ask a question about Botany" }).fill("How does osmosis move water?");
  await page.getByRole("button", { name: "Send" }).click();
  const answer = page.getByRole("article", { name: "Answer from your notes" });
  await expect(answer).toBeVisible({ timeout: 15_000 });
  await expectNoA11yViolations(page);
  await answer.getByRole("button", { name: /^Source 1:/ }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);
});

test("a question's answer, alternatives and explanation never reach the browser before it is checked", async ({ page }) => {
  await subjectWithNote(page, "Anatomy");
  // Every response from the quiz pages, read in full (server action replies stream, so the
  // response event can't always give their body).
  const bodies: string[] = [];
  await page.route(/\/quizzes\//, async (route) => {
    const res = await route.fetch();
    const body = await res.text();
    bodies.push(body);
    await route.fulfill({ response: res, body });
  });
  const dialog = await makeQuiz(page);
  await dialog.getByRole("link", { name: "Start quiz" }).click();
  await expect(page.getByTestId("question")).toBeVisible();
  // The attempt (prompts and options) came from a server action on this page.
  await expect.poll(() => bodies.some((b) => b.includes("attemptId"))).toBe(true);
  const seen = bodies.join("\n") + (await page.content());
  const KEYS = ["correctIndex", "correctChoice", "\"explanation\"", "\"accepted\"", "sourceQuote", "\"answer\"", "\"quote\""];
  for (const key of KEYS) expect(seen, key).not.toContain(key);

  // After checking, the answer does come back for that question (so the check above can see them).
  const before = bodies.length;
  await page.getByTestId("question").getByRole("button", { name: "I don't know" }).click();
  await expect(page.getByTestId("feedback")).toBeVisible();
  await expect.poll(() => bodies.slice(before).join("\n")).toContain("\"explanation\"");
});

test("HTML typed into a note stays text in a chat answer and its citation preview", async ({ page }) => {
  const hostile = 'Osmosis is the movement of water <img src=x onerror="window.__xss=1"> across a partially permeable <b>membrane</b>. Ribosomes build proteins from amino acids.';
  await subjectWithNote(page, "Biochem", hostile);
  await page.goto(page.url().replace(/\/?$/, "/ask"));
  await page.getByRole("textbox", { name: "Ask a question about Biochem" }).fill("What is osmosis, the movement of water?");
  await page.getByRole("button", { name: "Send" }).click();
  const answer = page.getByRole("article", { name: "Answer from your notes" });
  await expect(answer).toBeVisible({ timeout: 15_000 });
  await answer.getByRole("button", { name: /^Source 1:/ }).click();
  const preview = page.getByRole("dialog");
  await expect(preview).toBeVisible();
  // The tags are shown (or dropped) as text; nothing ran and no element was made from them.
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();
  expect(await page.locator('main img[src="x"], main b').count()).toBe(0);
  await expect(preview).toContainText("Osmosis is the movement of water");
});

// The quiz page was keyed on the attempt it found, and making a quiz refreshes the page. After a
// resumed attempt was finished, "Practise what I missed" → Make quiz refreshed into "no unfinished
// attempt": the screen remounted, the "Quiz ready!" dialog vanished and a new attempt started.
test("practise what I missed after a resumed quiz keeps the results and the new quiz's dialog", async ({ page }) => {
  await subjectWithNote(page, "Zoology");
  const dialog = await makeQuiz(page);
  await dialog.getByRole("link", { name: "Start quiz" }).click();
  const q = page.getByTestId("question");
  await expect(q).toBeVisible();
  await q.getByRole("button", { name: "I don't know" }).click();
  await page.getByTestId("feedback").getByRole("button", { name: "Next question" }).click();
  await expect(q).toBeVisible();
  // Come back later (a reload resumes the attempt).
  await page.reload();
  await expect(q).toBeVisible();
  for (;;) {
    await page.getByTestId("question").getByRole("button", { name: "I don't know" }).click();
    const next = page.getByTestId("feedback").getByRole("button", { name: /^(Next question|See results)$/ });
    const last = (await next.textContent()) === "See results";
    await next.click();
    if (last) break;
  }
  const practise = page.getByRole("button", { name: "Practise what I missed" });
  await expect(practise).toBeVisible();
  await practise.click();
  const make = page.locator("dialog[open]");
  await make.getByRole("button", { name: "Make quiz" }).click();
  await expect(make.getByRole("heading", { name: /^Quiz ready!/ })).toBeVisible({ timeout: 15_000 });
  // The refresh after making it has landed; nothing was reset.
  await page.waitForLoadState("networkidle");
  await expect(make.getByRole("heading", { name: /^Quiz ready!/ })).toBeVisible();
  await expect(practise).toBeVisible();
  await expect(page.getByTestId("question")).toHaveCount(0);
});
