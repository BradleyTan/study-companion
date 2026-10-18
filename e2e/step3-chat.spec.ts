import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, smallTargets, startDemo } from "./helpers";

// Demo mode has no AI key and no embeddings: retrieval is by keywords (the hint shows) and the
// deterministic local generator answers with the note's own sentences, each cited.
const TITLE = "Cell structure";
const NOTE = [
  "The mitochondria is the organelle that makes energy for the cell through respiration.",
  "Ribosomes are small structures that build proteins from amino acids.",
  "Osmosis is the movement of water across a partially permeable membrane.",
  "Photosynthesis means turning light energy into chemical energy inside chloroplasts.",
].join(" ");
const NOT_COVERED = "Your notes don't cover that yet, so I won't guess.";

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

async function openChat(page: Page) {
  await page.getByRole("link", { name: "Ask your notes, Ask anything in your notes" }).click();
  await expect(page).toHaveURL(/\/ask$/);
  await expect(page.getByRole("heading", { name: "Ask your notes", exact: true })).toBeVisible();
}

async function ask(page: Page, subject: string, question: string) {
  const before = await page.getByRole("article", { name: /^(Answer from your notes|Not in your notes)$/ }).count();
  await page.getByRole("textbox", { name: `Ask a question about ${subject}` }).fill(question);
  await page.getByRole("button", { name: "Send" }).click();
  const replies = page.getByRole("article", { name: /^(Answer from your notes|Not in your notes)$/ });
  await expect(replies).toHaveCount(before + 1, { timeout: 15_000 });
  return replies.last();
}

test("asks a question, opens a citation, gets an honest not-covered reply, clears the chat", async ({ page }) => {
  await subjectWithNote(page, "Biology");
  await openChat(page);
  await expect(page.getByText("Ask your notes anything")).toBeVisible();
  const suggestions = page.getByRole("group", { name: "Suggested questions" });
  await expect(suggestions.getByRole("button", { name: `What are the key points of ${TITLE}?` })).toBeVisible();
  await expect(suggestions.getByRole("button", { name: "Quiz me with one question" })).toBeVisible();
  await expect(page.getByTestId("keyword-hint")).toHaveText("Searching your notes by keywords today, so answers may miss a few things.");
  await expect(page.getByTestId("chat-quota")).toHaveText("20 of 20 questions left today");
  await expect(page.getByRole("button", { name: "Send" })).toBeDisabled();
  await expectNoA11yViolations(page);

  // An answer: every sentence cited, numbered chips, a sources list.
  const answer = await ask(page, "Biology", "What is osmosis?");
  await expect(page.getByRole("article", { name: "You asked" })).toHaveText("What is osmosis?");
  await expect(answer).toContainText("Osmosis is the movement of water across a partially permeable membrane.");
  await expect(page.getByTestId("chat-quota")).toHaveText("19 of 20 questions left today");
  await expect(page.getByTestId("chat-live")).toHaveText(/^Answer: .*Osmosis is the movement of water.* 1 source\.$/);
  await expect(page.getByRole("textbox", { name: "Ask a question about Biology" })).toHaveValue("");
  const chip = answer.getByRole("button", { name: `Source 1: ${TITLE} (note)` });
  await expect(chip).toBeVisible();

  // The chip opens the passage in place, with the cited sentence marked; Esc returns to the chip.
  await chip.click();
  const preview = page.getByTestId("citation-preview");
  await expect(preview.getByRole("heading")).toContainText(`${TITLE} (note)`);
  await expect(preview.locator("mark")).toContainText("Osmosis is the movement of water");
  await expect(preview.getByRole("link", { name: "Open in note" })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.keyboard.press("Escape");
  await expect(preview).toBeHidden();
  await expect(chip).toBeFocused();

  // The sources list links to the passage in the note (passageHref), and Back returns to the chat.
  await answer.getByTestId("sources").getByRole("link", { name: `Source 1: From ${TITLE} (note)` }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]+\?quote=[0-9a-f-]+$/);
  await page.goBack();
  await expect(page.getByRole("article", { name: "Answer from your notes" })).toContainText("Osmosis is the movement of water");

  // Not in the notes: no model call, no question used.
  const missing = await ask(page, "Biology", "What is the capital of France?");
  await expect(missing).toHaveAccessibleName("Not in your notes");
  await expect(missing).toContainText(NOT_COVERED);
  await expect(missing).toContainText("Try asking about something in your notes, or add a note about it.");
  await expect(page.getByTestId("chat-quota")).toHaveText("19 of 20 questions left today");

  // History is saved: a reload shows both exchanges.
  await page.reload();
  await expect(page.getByRole("article", { name: "You asked" })).toHaveCount(2);
  await expect(page.getByTestId("day-chip").first()).toHaveText("Today");

  // Clear chat (asks first; notes stay).
  await page.getByRole("button", { name: "Chat options" }).click();
  await page.getByRole("button", { name: "Clear chat" }).click();
  const confirm = page.getByRole("dialog", { name: "Clear this chat?" });
  await expect(confirm).toContainText("Your notes stay as they are.");
  await confirm.getByRole("button", { name: "Clear chat" }).click();
  await expect(page.getByText("Ask your notes anything")).toBeVisible();
  await expect(page.getByRole("article")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("article")).toHaveCount(0);
});

test("quiz me from a suggestion, with the answer behind Show answer; feedback and copy", async ({ page, context, isMobile }) => {
  await subjectWithNote(page, "Chemistry");
  await openChat(page);
  await page.getByRole("group", { name: "Suggested questions" }).getByRole("button", { name: "Quiz me with one question" }).click();
  const answer = page.getByRole("article", { name: "Answer from your notes" });
  await expect(answer).toContainText(/Fill the gap: .*____/, { timeout: 15_000 });
  await expect(answer.getByTestId("reveal")).toHaveCount(0);
  await answer.getByRole("button", { name: "Show answer" }).click();
  await expect(answer.getByTestId("reveal")).toBeVisible();

  await answer.getByRole("button", { name: "Not right?" }).click();
  await page.getByRole("button", { name: "Too long" }).click();
  await expect(page.getByText("Thanks for telling us.")).toBeVisible();

  if (!isMobile) {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await answer.getByRole("button", { name: "Copy" }).click();
    await expect(page.getByText("Copied")).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toMatch(/^Fill the gap: .*____/);
    expect(copied).toContain(`Sources:\n1. ${TITLE} (note)`);
    expect(copied).not.toMatch(/\[1\]/);
  }
});

test("the daily limit: the chip shows from 3 left, then the composer becomes the limit sticker", async ({ page }) => {
  test.slow();
  await subjectWithNote(page, "Physics");
  await openChat(page);
  // Different questions, so none is answered from the cache (cached answers are free).
  for (let i = 1; i <= 17; i++) await ask(page, "Physics", `What is osmosis, part ${i}?`);
  await expect(page.getByTestId("chat-quota")).toHaveText("3 of 20 questions left today");
  await expect(page.getByTestId("chat-quota")).toBeVisible();
  for (let i = 18; i <= 20; i++) await ask(page, "Physics", `What is osmosis, part ${i}?`);
  const limit = page.getByTestId("chat-limit");
  await expect(limit).toContainText("You've asked 20 questions today. More tomorrow! Your chat is saved.");
  await expect(limit.getByRole("link", { name: "Make a quiz" })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Ask a question about Physics" })).toHaveCount(0);
  // Not-covered replies would still be free, but nothing can be sent until tomorrow.
  await page.reload();
  await expect(page.getByTestId("chat-limit")).toBeVisible();
  await expect(page.getByRole("article", { name: "You asked" })).toHaveCount(20);
});

test("no notes yet: the composer is disabled with the reason", async ({ page }) => {
  await startDemo(page);
  await createSubject(page, "History");
  await page.getByRole("link", { name: /History/ }).click();
  await openChat(page);
  await expect(page.getByTestId("chat-no-sources")).toContainText("Add a note or a lecture file first, then ask away.");
  const box = page.getByRole("textbox", { name: "Ask a question about History" });
  await expect(box).toBeDisabled();
  await expect(box).toHaveAccessibleDescription(/Add a note or a lecture file first, then ask away\./);
  await page.getByTestId("chat-no-sources").getByRole("link", { name: "Back to History" }).click();
  await expect(page).toHaveURL(/\/subjects\/[0-9a-f-]+$/);
});

test("keyboard: / focuses the composer, Enter sends, Shift+Enter adds a line", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard shortcuts are for laptops");
  await subjectWithNote(page, "Maths");
  await openChat(page);
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("/");
  const box = page.getByRole("textbox", { name: "Ask a question about Maths" });
  await expect(box).toBeFocused();
  await page.keyboard.type("What do ribosomes build?");
  await page.keyboard.press("Shift+Enter");
  await expect(box).toHaveValue("What do ribosomes build?\n");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("article", { name: "Answer from your notes" })).toContainText("Ribosomes are small structures that build proteins", { timeout: 15_000 });
  await expect(box).toBeFocused();
});

test.describe("phone width (375 px)", () => {
  test.use({ viewport: { width: 375, height: 740 } });
  test("the chat fits without sideways scrolling and keeps its touch targets", async ({ page, isMobile }) => {
    await subjectWithNote(page, "Geography");
    await expectNoHorizontalScroll(page);
    await openChat(page);
    await expectNoHorizontalScroll(page);
    await ask(page, "Geography", "What does photosynthesis turn light energy into?");
    await ask(page, "Geography", "Who won the 1998 World Cup?");
    await expectNoHorizontalScroll(page);
    // Citation chips are 24 px to look at with a 44 px hit area around them (chat.md).
    if (isMobile) {
      // Measure once the answer's pop-in (a scale) has finished.
      await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== "running"));
      expect((await smallTargets(page)).filter((t) => !/^button "Source \d+:/.test(t))).toEqual([]);
    }
    await page.getByRole("button", { name: /^Source 1: / }).first().click();
    const preview = page.getByTestId("citation-preview");
    await expect(preview).toBeVisible();
    await expectNoHorizontalScroll(page);
    await preview.getByRole("button", { name: "Close" }).click();
    await expect(preview).toBeHidden();
    await expectNoA11yViolations(page);
  });
});
