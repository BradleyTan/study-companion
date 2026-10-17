import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, rowAction, startDemo } from "./helpers";

// Demo mode has no AI key, so the deterministic local generator makes the cards and maps.
const NOTE = [
  "The mitochondria is the organelle that makes energy for the cell through respiration.",
  "Ribosomes are small structures that build proteins from amino acids.",
  "The nucleus contains the genetic material of the cell and controls its activity.",
  "Photosynthesis means turning light energy into chemical energy inside chloroplasts.",
  "The cell membrane is a thin layer that controls what enters and leaves the cell.",
].join(" ");

async function subjectWithNote(page: Page, subject: string, title = "Cell structure") {
  await startDemo(page);
  await createSubject(page, subject);
  await page.getByRole("link", { name: new RegExp(subject) }).click();
  await page.getByRole("button", { name: "+ Write a note" }).click();
  await expect(page).toHaveURL(/\/notes\//);
  await page.getByLabel("Title").fill(title);
  await page.getByRole("textbox", { name: "Note text" }).click();
  await page.keyboard.insertText(NOTE);
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
}

/** A fake speechSynthesis that records what it was asked to say and only ends on request. */
async function stubSpeech(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    const spoken: string[] = [];
    let current: { onend?: () => void } | null = null;
    w.__spoken = spoken;
    w.__finishSentence = () => { const u = current; current = null; u?.onend?.(); };
    class Utterance { text: string; rate = 1; lang = ""; voice: unknown = null; onend?: () => void; onerror?: () => void; constructor(t: string) { this.text = t; } }
    const voice = { name: "Test Voice", lang: "en-GB", voiceURI: "test-voice", localService: true, default: true };
    const synth = {
      speaking: false, paused: false, pending: false,
      getVoices: () => [voice],
      speak: (u: Utterance) => { spoken.push(u.text); current = u; },
      cancel: () => { current = null; },
      pause: () => {}, resume: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
  });
}

test("make flashcards from a note, edit and delete a card, follow its source link", async ({ page }) => {
  await subjectWithNote(page, "Biology");

  await page.getByRole("button", { name: /Make flashcards/ }).click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByText("Cell structure")).toBeVisible();
  await expect(dialog.getByTestId("quota-chip")).toHaveText("15 of 15 left today");
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(dialog.getByRole("heading", { name: /new cards?!/ })).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("Your notes had enough for")).toBeVisible();
  await expectNoA11yViolations(page);
  await dialog.getByRole("button", { name: "Done" }).click();

  await page.getByRole("link", { name: "← Back to Biology" }).click();
  await page.getByRole("link", { name: /^Flashcards/ }).click();
  await expect(page).toHaveURL(/\/flashcards$/);
  const cards = page.getByRole("list", { name: "Cards" }).getByRole("article");
  await expect(cards.first()).toBeVisible();
  const total = await cards.count();
  expect(total).toBeGreaterThan(1);
  await expect(page.getByTestId("quota-chip").first()).toHaveText("14 of 15 left today");
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);

  // Edit the first card: the text changes and it's marked as edited.
  await page.getByRole("button", { name: /^Edit card:/ }).first().click();
  await page.getByLabel("Front").fill("What powers the cell?");
  await page.getByRole("button", { name: "Save card" }).click();
  await expect(cards.first()).toContainText("What powers the cell?");
  await expect(cards.first().getByText("Edited")).toBeVisible();

  // Delete the last card, then undo, then delete it for real.
  await page.getByRole("button", { name: /^Delete card:/ }).last().click();
  await page.getByRole("group", { name: "Delete this card?" }).getByRole("button", { name: "Delete" }).click();
  await expect(cards).toHaveCount(total - 1);
  await page.getByTestId("toast").getByRole("button", { name: "Undo" }).click();
  await expect(cards).toHaveCount(total);

  // The source link opens the note with the quoted passage marked.
  await cards.first().getByRole("link", { name: "Cell structure" }).click();
  await expect(page).toHaveURL(/\/notes\/.+\?(quote|card)=/);
  await expect(page.getByTestId("passage-mark")).toBeVisible();
});

test("review session: flip, grade, undo, finish", async ({ page }) => {
  await subjectWithNote(page, "Chemistry", "Acids");
  await page.getByRole("button", { name: /Make flashcards/ }).click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await dialog.getByRole("link", { name: "Start reviewing" }).click();
  await expect(page).toHaveURL(/\/review$/);
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: /^Show answer/ }).click();
  await expect(page.getByRole("group", { name: "How well did you remember it?" })).toBeVisible();
  await expectNoA11yViolations(page);
  const progress = page.getByRole("progressbar", { name: "Session progress" });
  await page.getByRole("button", { name: /^Good, next review/ }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "1");
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(progress).toHaveAttribute("aria-valuenow", "0");

  // Keyboard: Space flips, 4 = Easy (graduates the card, so the session ends).
  for (let i = 0; i < 40; i++) {
    if (await page.getByRole("heading", { name: "Deck done!" }).isVisible()) break;
    await page.getByRole("button", { name: /^Show answer/ }).waitFor();
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: /^Easy, next review/ }).waitFor();
    await page.keyboard.press("4");
  }
  await expect(page.getByRole("heading", { name: "Deck done!" })).toBeVisible();
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);

  // Nothing left today on the subjects page.
  await page.goto("/subjects");
  await expect(page.getByText("All caught up for today ✓")).toBeVisible();
});

test("mindmap: make, open a passage, move a topic, outline view", async ({ page }) => {
  await subjectWithNote(page, "Physics", "Forces");
  await page.getByRole("link", { name: "← Back to Physics" }).click();
  await page.getByRole("link", { name: /^Mindmap/ }).click();
  await expect(page.getByText("No mindmap yet")).toBeVisible();
  await expect(page.getByTestId("quota-chip").first()).toHaveText("3 of 3 left today");
  await expectNoA11yViolations(page);

  await page.getByRole("button", { name: "Make a mindmap" }).click();
  const nodes = page.locator(".react-flow__node");
  await expect(nodes.first()).toBeVisible({ timeout: 15_000 });
  expect(await nodes.count()).toBeGreaterThan(2);
  await expect(page.getByTestId("mindmap-meta")).toContainText("Made from 1 note");
  await expect(page.getByTestId("quota-chip").first()).toHaveText("2 of 3 left today");
  const gotIt = page.getByRole("button", { name: "Got it" }); // one-time touch hint on phones
  if (await gotIt.isVisible()) await gotIt.click();
  await expectNoHorizontalScroll(page);

  // Keyboard: focus a topic, Enter opens its passage.
  const topic = page.locator('.react-flow__node[data-id="n1"]');
  await topic.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByTestId("passage-panel");
  await expect(panel.getByRole("heading")).toBeVisible();
  await expect(panel).toContainText("From Forces (note)");
  await expect(panel.getByRole("link", { name: "Open in note" })).toBeVisible();
  await expectNoA11yViolations(page);
  await panel.getByRole("button", { name: "Close" }).click();
  await expect(panel).toBeHidden();
  await expect(topic).toBeFocused();

  // Arrow keys move the selected topic and the layout saves.
  await topic.click({ position: { x: 4, y: 4 } });
  await panel.getByRole("button", { name: "Close" }).click();
  await topic.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await expect(page.getByTestId("layout-save")).toHaveText("Saved ✓", { timeout: 5000 });

  // Outline view is remembered.
  await page.getByRole("button", { name: "Outline" }).click();
  const tree = page.getByRole("tree");
  await expect(tree).toBeVisible();
  await expectNoA11yViolations(page);
  await page.reload();
  await expect(page.getByRole("tree")).toBeVisible();
  await page.getByRole("button", { name: /^Show passage:/ }).first().click();
  await expect(panel.getByRole("link", { name: "Open in note" })).toBeVisible();
  await panel.getByRole("link", { name: "Open in note" }).click();
  await expect(page.getByTestId("passage-mark")).toBeVisible();
});

test("read aloud in the note editor", async ({ page }) => {
  await stubSpeech(page);
  await subjectWithNote(page, "History", "Romans");
  await page.getByRole("button", { name: "Read aloud" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await expect(bar).toBeVisible();
  await expect(bar.getByTestId("read-aloud-status")).toHaveText("Ready");
  await expectNoA11yViolations(page);

  await page.keyboard.press("Control+Home");
  await bar.getByRole("button", { name: "▶ Play" }).click();
  await expect(bar.getByTestId("read-aloud-status")).toHaveText(/Reading sentence 1 of \d+/);
  await expect(page.getByTestId("speaking-mark")).toBeVisible();
  const first = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken[0]);
  expect(first.length).toBeGreaterThan(0);

  await page.evaluate(() => (window as unknown as { __finishSentence: () => void }).__finishSentence());
  await expect(bar.getByTestId("read-aloud-status")).toHaveText(/Reading sentence 2 of/);
  await bar.getByRole("button", { name: "❚❚ Pause" }).click();
  await expect(bar.getByTestId("read-aloud-status")).toHaveText(/Paused at sentence 2 of/);
  await bar.getByRole("button", { name: "■ Stop" }).click();
  await expect(bar.getByTestId("read-aloud-status")).toHaveText("Stopped");
  await expect(bar.getByLabel("Speed")).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test.describe("at 375 px", () => {
  test.use({ viewport: { width: 375, height: 740 } });

  test("deck, review and mindmap fit a small phone", async ({ page }) => {
    await subjectWithNote(page, "Maths", "Sets");
    await expectNoHorizontalScroll(page);
    await page.getByRole("button", { name: /Make flashcards/ }).click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("button", { name: "Make flashcards" }).click();
    await expect(dialog.getByRole("heading", { name: /new cards?!/ })).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    await dialog.getByRole("button", { name: "Done" }).click();

    const subjectUrl = page.url().replace(/\/notes\/.*$/, "");
    await page.goto(`${subjectUrl}/flashcards`);
    await expect(page.getByRole("list", { name: "Cards" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.goto(`${subjectUrl}/review`);
    await page.getByRole("button", { name: /^Show answer/ }).click();
    await expect(page.getByRole("group", { name: "How well did you remember it?" })).toBeVisible();
    await expectNoHorizontalScroll(page);

    await page.goto(`${subjectUrl}/mindmap`);
    await page.getByRole("button", { name: "Make a mindmap" }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 15_000 });
    await expectNoHorizontalScroll(page);
    await expectNoA11yViolations(page);
  });
});

test("cards from a lecture file link to the read-only source page", async ({ page }) => {
  await startDemo(page);
  await createSubject(page, "Anatomy");
  await page.getByRole("link", { name: /Anatomy/ }).click();
  await page.locator("#file-input").setInputFiles(path.join(__dirname, "fixtures", "heart.pdf"));
  await expect(page.getByText("Ready · 2 pages")).toBeVisible({ timeout: 15_000 });
  await rowAction(page, "heart.pdf", "Make flashcards", "Make flashcards from heart.pdf");
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(dialog.getByRole("heading", { name: /new cards?!/ })).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Done" }).click();

  await page.getByRole("link", { name: /^Flashcards/ }).click();
  await page.getByRole("list", { name: "Cards" }).getByRole("article").first().getByRole("link", { name: "heart.pdf" }).click();
  await expect(page).toHaveURL(/\/sources\/.+\?(quote|card)=/);
  await expect(page.getByRole("heading", { level: 1, name: "heart.pdf" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Page \d+$/ }).first()).toBeVisible();
  await expect(page.getByTestId("passage-mark")).toBeVisible();
  await expect(page.getByRole("button", { name: "Open the original file" })).toBeEnabled();
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);
});
