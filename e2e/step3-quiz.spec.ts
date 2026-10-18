import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, rowAction, smallTargets, startDemo } from "./helpers";

// Demo mode has no AI key, so the deterministic local generator writes the quiz. Its questions
// blank a word out of a sentence of the note, so the test works out the right answer from NOTE.
const TITLE = "Cell structure";
const NOTE = [
  "The mitochondria is the organelle that makes energy for the cell through respiration.",
  "Ribosomes are small structures that build proteins from amino acids.",
  "The nucleus contains the genetic material of the cell and controls its activity.",
  "Photosynthesis means turning light energy into chemical energy inside chloroplasts.",
  "The cell membrane is a thin layer that controls what enters and leaves the cell.",
  "Osmosis is the movement of water across a partially permeable membrane.",
].join(" ");
const SOURCE = `${TITLE} ${NOTE}`;
const RIGHT = /^(Correct!|Nailed it!|Yes! That's it\.)/;
const WRONG = /^(Not quite\.|Close one\.|Not this time\.)/;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

/** The word that fills the blank, read from the note itself. */
function fillFor(prompt: string): string {
  const sentence = prompt.match(/“(.+)”/)?.[1] ?? prompt;
  const [before, after] = sentence.split("____");
  const re = new RegExp(`${esc(before.trim())}\\s*(\\S+?)\\s*${esc(after.trim())}`, "i");
  const hit = SOURCE.match(re)?.[1];
  if (!hit) throw new Error(`No answer in the note for: ${prompt}`);
  return hit;
}

async function subjectWithNote(page: Page, subject: string) {
  await startDemo(page);
  await createSubject(page, subject);
  await page.getByRole("link", { name: new RegExp(subject) }).click();
  await page.getByRole("button", { name: "+ Write a note" }).click();
  await expect(page).toHaveURL(/\/notes\//);
  await page.getByLabel("Title").fill(TITLE);
  await page.getByRole("textbox", { name: "Note text" }).click();
  await page.keyboard.insertText(NOTE);
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
  await page.getByRole("link", { name: `← Back to ${subject}` }).click();
}

async function makeQuizFromNote(page: Page, kind: "Multiple choice" | "Fill in the blank" | "Mixed" = "Mixed", count = "5") {
  await rowAction(page, TITLE, "Make a quiz", `Make a quiz from ${TITLE}`);
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByText(`From ${TITLE}.`)).toBeVisible();
  await expect(dialog.getByTestId("quota-chip")).toHaveText(/of 3 left today/);
  await dialog.getByRole("radiogroup", { name: "Question type" }).getByText(kind, { exact: true }).click();
  await dialog.getByRole("radiogroup", { name: "How many questions" }).getByText(count, { exact: true }).click();
  await dialog.getByRole("button", { name: "Make quiz" }).click();
  await expect(dialog.getByRole("heading", { name: /^Quiz ready! \d+ questions?$/ })).toBeVisible({ timeout: 15_000 });
  return dialog;
}

/** Answers the current question right or wrong (or "I don't know") and returns the feedback panel. */
async function answer(page: Page, how: "right" | "wrong" | "dont_know") {
  const q = page.getByTestId("question");
  await expect(q).toBeVisible();
  const type = await q.getAttribute("data-type");
  const prompt = (await q.getAttribute("data-prompt"))!;
  if (how === "dont_know") {
    await q.getByRole("button", { name: "I don't know" }).click();
  } else if (type === "mcq") {
    const right = fillFor(prompt).toLowerCase();
    const options = q.getByTestId("option");
    const texts = (await options.allTextContents()).map((t) => t.replace(/^[A-D]/, "").replace(/^[A-D], /, "").trim().toLowerCase());
    const i = texts.findIndex((t) => t.endsWith(right));
    expect(i).toBeGreaterThanOrEqual(0);
    await options.nth(how === "right" ? i : (i + 1) % 4).click();
    await q.getByRole("button", { name: "Check" }).click();
  } else {
    await q.getByLabel("Your answer").fill(how === "right" ? fillFor(prompt) : "zzzz");
    await q.getByRole("button", { name: "Check" }).click();
  }
  const fb = page.getByTestId("feedback");
  await expect(fb).toBeVisible();
  return fb;
}

test("build a quiz, take it (right and wrong), see results, weak topics and practise what I missed", async ({ page }) => {
  await subjectWithNote(page, "Biology");
  const dialog = await makeQuizFromNote(page, "Mixed", "5");
  await expect(dialog.getByText(`From ${TITLE} · Mixed`)).toBeVisible();
  await expectNoA11yViolations(page);
  await dialog.getByRole("link", { name: "Start quiz" }).click();
  await expect(page).toHaveURL(/\/quizzes\/[0-9a-f-]+\?attempt=/);
  await expect(page.getByTestId("progress-text")).toHaveText(/^Question 1 of \d$/);
  const total = Number((await page.getByTestId("progress-text").textContent())!.match(/of (\d)/)![1]);
  expect(total).toBeGreaterThanOrEqual(3);
  await expectNoA11yViolations(page);

  // Q1 right.
  let fb = await answer(page, "right");
  await expect(fb.getByRole("heading")).toHaveText(RIGHT);
  await expect(fb.getByText(/^From /)).toBeVisible();
  await expectNoA11yViolations(page);
  await fb.getByRole("button", { name: "Next question" }).click();

  // Q2 wrong: the right answer is shown, the source quote too.
  fb = await answer(page, "wrong");
  await expect(fb.getByRole("heading")).toHaveText(WRONG);
  await expect(page.getByRole("progressbar", { name: "Quiz progress" })).toHaveAttribute("aria-valuetext", `2 of ${total} answered`);
  await expectNoA11yViolations(page);
  await fb.getByRole("button", { name: "Next question" }).click();

  for (let i = 3; i <= total; i++) {
    fb = await answer(page, "right");
    await fb.getByRole("button", { name: i === total ? "See results" : "Next question" }).click();
  }

  // Results.
  await expect(page.getByTestId("score")).toHaveText(`${total - 1} / ${total}`);
  await expect(page.getByTestId("weak-line")).toContainText("Added to your weak topics:");
  await expect(page.getByRole("button", { name: "Practise what I missed" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your answers" })).toBeVisible();
  await expect(page.getByText("Missed", { exact: false }).first()).toBeVisible();
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);

  // A refresh keeps the results.
  await page.reload();
  await expect(page.getByTestId("score")).toHaveText(`${total - 1} / ${total}`);

  // Practise what I missed: Focus = weak topics with this quiz's missed topic ticked.
  await page.getByRole("button", { name: "Practise what I missed" }).click();
  const remix = page.locator("dialog[open]");
  await expect(remix.getByRole("radiogroup", { name: "Focus" }).getByRole("radio", { name: /Weak topics · 1/ })).toBeChecked();
  await expect(remix.getByRole("checkbox")).toHaveCount(1);
  await expect(remix.getByRole("checkbox")).toBeChecked();
  await expect(remix.getByTestId("quota-chip")).toHaveText("2 of 3 left today");
  await remix.getByRole("button", { name: "Make quiz" }).click();
  await expect(remix.getByRole("heading", { name: /^Quiz ready!/ })).toBeVisible({ timeout: 15_000 });
  await expect(remix.getByText("From your weak topics · Mixed")).toBeVisible();
  await remix.getByRole("button", { name: "Later" }).click();

  // Weak topics page.
  await page.getByRole("link", { name: "See weak topics" }).click();
  await expect(page).toHaveURL(/\/weak-topics$/);
  const topics = page.getByRole("list", { name: "Open weak topics" }).getByRole("article");
  await expect(topics).toHaveCount(1);
  await expect(topics.first()).toContainText("Missed once · last today");
  await expect(topics.first().getByRole("img", { name: "Last 1 try: missed" })).toBeVisible();
  await expect(topics.first().getByRole("link", { name: TITLE })).toBeVisible();
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);

  // Mark as got it, undo, then for real: the list is all clear.
  const topicName = (await topics.first().getByRole("heading").textContent())!;
  await topics.first().getByRole("button", { name: `More actions for ${topicName}` }).click();
  await page.getByRole("button", { name: "Mark as got it" }).click();
  await expect(page.getByTestId("toast")).toContainText("Nice! Moved to Got it.");
  await page.getByTestId("toast").getByRole("button", { name: "Undo" }).click();
  await expect(topics).toHaveCount(1);
  await topics.first().getByRole("button", { name: `More actions for ${topicName}` }).click();
  await page.getByRole("button", { name: "Mark as got it" }).click();
  await expect(page.getByText("All clear!")).toBeVisible();
  await expect(page.getByRole("button", { name: "Got it now (1)" })).toHaveAttribute("aria-expanded", "true");

  // The subject page shows the Quizzes tile, and no weak-topics strip once all are cleared.
  await page.getByRole("link", { name: "← Biology" }).click();
  await expect(page.getByRole("link", { name: /^Quizzes, best \d out of \d, 2 quizzes$/ })).toBeVisible();
  await expect(page.getByTestId("ask-tile")).toContainText("Coming soon");
  await expect(page.getByTestId("weak-strip")).toHaveCount(0);
});

test("fill in the blank: I don't know, a wrong answer counted as right, and the shelf", async ({ page }) => {
  await subjectWithNote(page, "Chemistry");
  const dialog = await makeQuizFromNote(page, "Fill in the blank", "5");
  await dialog.getByRole("link", { name: "Start quiz" }).click();

  let fb = await answer(page, "dont_know");
  await expect(fb.getByRole("heading")).toHaveText(/^No worries\. Here's the answer\./);
  await expect(fb.getByTestId("right-answer")).toBeVisible();
  await fb.getByRole("button", { name: "Next question" }).click();

  fb = await answer(page, "wrong");
  await expect(fb.getByRole("heading")).toHaveText(WRONG);
  await fb.getByRole("button", { name: "I think my answer is right" }).click();
  await expect(fb.getByText("Count ‘zzzz’ as right?")).toBeVisible();
  await fb.getByRole("button", { name: "Count it" }).click();
  await expect(fb.getByRole("heading")).toHaveText(/^Counted as right\./);

  // End early: answers are saved and the shelf offers to pick up where you left off.
  await page.getByRole("button", { name: "✕ End" }).click();
  await expect(page.getByText("You answered 2 of")).toBeVisible();
  await page.getByRole("link", { name: "Back to quizzes" }).click();
  await expect(page.getByTestId("resume")).toContainText("question 3 of");
  await expect(page.getByTestId("quiz-summary")).toContainText("1 quiz");
  await expectNoA11yViolations(page);
  await page.getByTestId("resume").getByRole("link", { name: "Keep going" }).click();
  await expect(page.getByTestId("progress-text")).toHaveText(/^Question 3 of/);

  // Delete from the shelf, with Undo.
  await page.goto(page.url().replace(/\/quizzes\/.*$/, "/quizzes"));
  const quiz = page.getByRole("list", { name: "Quizzes" }).getByRole("article");
  await expect(quiz).toHaveCount(1);
  const name = (await quiz.getByRole("heading").textContent())!;
  await quiz.getByRole("button", { name: `More for ${name}` }).click();
  await page.getByRole("button", { name: "Delete quiz" }).click();
  await quiz.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByTestId("toast")).toContainText("Quiz deleted");
  await page.getByTestId("toast").getByRole("button", { name: "Undo" }).click();
  await expect(page.getByRole("list", { name: "Quizzes" }).getByRole("article")).toHaveCount(1);
});

test("keyboard: choose with a number, check and move on with Enter", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcuts are for laptops");
  await subjectWithNote(page, "Physics");
  const dialog = await makeQuizFromNote(page, "Multiple choice", "5");
  await dialog.getByRole("link", { name: "Start quiz" }).click();
  const q = page.getByTestId("question");
  const right = fillFor((await q.getAttribute("data-prompt"))!).toLowerCase();
  const texts = (await q.getByTestId("option").allTextContents()).map((t) => t.trim().toLowerCase());
  const i = texts.findIndex((t) => t.endsWith(right));
  await page.keyboard.press(String(i + 1));
  await expect(q.getByRole("radio").nth(i)).toBeChecked();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("feedback").getByRole("heading")).toHaveText(RIGHT);
  await expect(q.getByText("Your answer, right answer")).toBeVisible();
  await page.locator("body").press("Enter");
  await expect(page.getByTestId("progress-text")).toHaveText(/^Question 2 of/);
});

test.describe("phone width (375 px)", () => {
  test.use({ viewport: { width: 375, height: 740 } });
  test("the shelf, a question, the results and weak topics fit without sideways scrolling", async ({ page, isMobile }) => {
    await subjectWithNote(page, "Geography");
    await expect(page.getByRole("link", { name: /^Quizzes, test yourself$/ })).toBeVisible();
    await expectNoHorizontalScroll(page);
    const dialog = await makeQuizFromNote(page, "Mixed", "5");
    await expectNoHorizontalScroll(page);
    await dialog.getByRole("button", { name: "Later" }).click();
    await page.getByRole("link", { name: /^Quizzes/ }).click();
    await expect(page.getByRole("list", { name: "Quizzes" }).getByRole("article")).toHaveCount(1);
    await expectNoHorizontalScroll(page);
    await expectNoA11yViolations(page);

    await page.getByRole("link", { name: /^Take quiz:/ }).click();
    const total = Number((await page.getByTestId("progress-text").textContent())!.match(/of (\d+)/)![1]);
    await expectNoHorizontalScroll(page);
    for (let i = 1; i <= total; i++) {
      const fb = await answer(page, i === 1 ? "wrong" : "right");
      if (i === 1) {
        await expectNoHorizontalScroll(page);
        if (isMobile) expect(await smallTargets(page)).toEqual([]);
      }
      await fb.getByRole("button", { name: i === total ? "See results" : "Next question" }).click();
    }
    await expect(page.getByTestId("score")).toHaveText(`${total - 1} / ${total}`);
    await expectNoHorizontalScroll(page);
    await page.getByRole("link", { name: "See weak topics" }).click();
    await expect(page.getByRole("list", { name: "Open weak topics" }).getByRole("article")).toHaveCount(1);
    await expectNoHorizontalScroll(page);

    // The subject page strip.
    await page.getByRole("link", { name: "← Geography" }).click();
    await expect(page.getByTestId("weak-strip")).toContainText("1 weak topic:");
    await expectNoHorizontalScroll(page);
  });
});
