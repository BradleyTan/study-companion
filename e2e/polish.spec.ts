import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, openSettings, rowAction, smallTargets, startDemo } from "./helpers";

// Polish pass (docs/design/polish.md): first run, 375 px layout, quiz option states, chat divider,
// theme focus ring, 44 px targets, empty states and the phone mindmap.

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
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

/** The word that fills the blank, read from the note (the demo generator blanks a word of a sentence). */
function fillFor(prompt: string): string {
  const sentence = prompt.match(/“(.+)”/)?.[1] ?? prompt;
  const [before, after] = sentence.split("____");
  const hit = SOURCE.match(new RegExp(`${esc(before.trim())}\\s*(\\S+?)\\s*${esc(after.trim())}`, "i"))?.[1];
  if (!hit) throw new Error(`No answer in the note for: ${prompt}`);
  return hit;
}

async function writeNote(page: Page, subject: string) {
  await page.getByRole("button", { name: "+ Write a note" }).first().click();
  await expect(page).toHaveURL(/\/notes\//);
  await page.getByLabel("Title").fill(TITLE);
  await page.getByRole("textbox", { name: "Note text" }).click();
  await page.keyboard.insertText(NOTE);
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
  await page.getByRole("link", { name: `← ${subject}`, exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: subject })).toBeVisible();
}

/** The computed background of a token, to compare with an element's. */
const tokenBg = (page: Page, token: string) => page.evaluate((t) => {
  const el = document.createElement("div");
  el.style.background = `var(${t})`;
  document.body.append(el);
  const bg = getComputedStyle(el).backgroundColor;
  el.remove();
  return bg;
}, token);

test("first run: the Start-here sticker shows until there is a note, and tiles say 'Add a note first'", async ({ page }) => {
  await startDemo(page);
  await createSubject(page, "Biology");
  await page.getByRole("link", { name: /Biology/ }).click();

  const start = page.getByTestId("start-here");
  await expect(start.getByRole("heading", { name: "Start with your notes" })).toBeVisible();
  await expect(start).toContainText("Write a note or upload a lecture file. Then StudyNest can turn it into flashcards, a mindmap and quizzes.");
  await expect(start).toContainText("1 Add notes · 2 Make flashcards · 3 Quiz yourself · 4 Start a focus round");
  for (const tool of ["Flashcards", "Mindmap", "Quizzes", "Ask your notes"]) {
    await expect(page.getByRole("link", { name: `${tool}, add a note first`, exact: true })).toBeVisible();
  }
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);

  // "Upload a file" focuses the file input in Lecture files.
  await start.getByRole("button", { name: "Upload a file" }).click();
  await expect(page.locator("#file-input")).toBeFocused();

  // Every tool page shows the same "nothing to work from" empty state.
  const subjectUrl = page.url();
  const empties: [string, string, string, string][] = [
    ["flashcards", "deck-no-sources", "No flashcards yet", "make cards from it"],
    ["mindmap", "mindmap-no-sources", "Nothing to map yet", "map it"],
    ["quizzes", "quiz-no-sources", "No quizzes yet", "quiz you on it"],
    ["ask", "chat-no-sources", "Nothing to ask yet", "answer from it"],
  ];
  for (const [path, id, title, then] of empties) {
    await page.goto(`${subjectUrl}/${path}`);
    const empty = page.getByTestId(id);
    await expect(empty.getByRole("heading", { name: title })).toBeVisible();
    await expect(empty).toContainText(`Add a note or a lecture file first, then we can ${then}.`);
    await expect(empty.getByRole("button", { name: "+ Write a note" })).toBeVisible();
    await expect(empty.getByRole("link", { name: "Upload a file" })).toHaveAttribute("href", /#files-h$/);
    await expect(page.getByRole("link", { name: /^Back to Biology$/ })).toHaveCount(0);
    if (path === "flashcards") await expect(empty.getByRole("button", { name: "Add a card" })).toBeVisible();
    await expectNoHorizontalScroll(page);
  }
  await expectNoA11yViolations(page);

  // "Write a note" from an empty state creates the note; back on the subject page the sticker is gone.
  await page.goto(subjectUrl);
  await writeNote(page, "Biology");
  await expect(page.getByTestId("start-here")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Flashcards, Make your first cards" })).toBeVisible();
});

test("a file alone also hides the sticker; the file row keeps its name and says Open", async ({ page, isMobile }) => {
  await startDemo(page);
  await createSubject(page, "Anatomy");
  await page.getByRole("link", { name: /Anatomy/ }).click();
  await expect(page.getByTestId("start-here")).toBeVisible();
  await page.locator("#file-input").setInputFiles(path.join(__dirname, "fixtures", "heart.pdf"));
  await expect(page.getByText("Ready · 2 pages")).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(page.getByTestId("start-here")).toHaveCount(0);

  // P1-8: the name gets its own line, never squeezed to "he…".
  const name = page.getByTestId("source-row").getByText("heart.pdf", { exact: true });
  const width = await name.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(60);
  if (isMobile) {
    await page.getByRole("button", { name: "More for heart.pdf" }).click();
    await expect(page.getByRole("button", { name: "Open", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Download" })).toHaveCount(0);
  } else {
    await expect(page.getByRole("button", { name: "Open heart.pdf" })).toBeVisible();
    await expect(page.getByRole("button", { name: /Download/ })).toHaveCount(0);
  }
});

test("375 px subject header: whole words, Edit/Delete in the More menu", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout.");
  await page.setViewportSize({ width: 375, height: 760 });
  await startDemo(page);
  await createSubject(page, "Biology");
  await page.getByRole("link", { name: /Biology/ }).click();
  const title = page.getByTestId("subject-title");
  await expect(title).toHaveText("Biology");
  // One line: the 30 px marker title is well under two lines tall.
  const h = await title.evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeLessThan(60);
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toBeHidden();
  await expect(page.getByRole("button", { name: "Delete", exact: true })).toBeHidden();
  await rowAction(page, "Biology", "Edit subject", "Edit");
  await expect(page.getByRole("dialog", { name: "Edit subject" })).toBeVisible();
  await page.keyboard.press("Escape");
  await rowAction(page, "Biology", "Delete subject", "Delete");
  await expect(page.getByRole("dialog", { name: "Delete Biology?" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expectNoHorizontalScroll(page);
  expect(await smallTargets(page)).toEqual([]);
});

test("quiz: a wrong pick turns coral, the right one mint; weak topics don't make the 375 px subject page scroll sideways", async ({ page, isMobile }) => {
  await startDemo(page);
  await createSubject(page, "Biology");
  await page.getByRole("link", { name: /Biology/ }).click();
  await writeNote(page, "Biology");

  await rowAction(page, TITLE, "Make a quiz", `Make a quiz from ${TITLE}`);
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("radiogroup", { name: "Question type" }).getByText("Multiple choice", { exact: true }).click();
  await dialog.getByRole("radiogroup", { name: "How many questions" }).getByText("5", { exact: true }).click();
  await dialog.getByRole("button", { name: "Make quiz" }).click();
  await expect(dialog.getByRole("heading", { name: /^Quiz ready!/ })).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("link", { name: "Start quiz" }).click();

  // Q1: pick a wrong option.
  const q = page.getByTestId("question");
  const right = fillFor((await q.getAttribute("data-prompt"))!).toLowerCase();
  const options = q.getByTestId("option");
  const texts = (await options.allTextContents()).map((t) => t.replace(/^[A-D]/, "").trim().toLowerCase());
  const i = texts.findIndex((t) => t.endsWith(right));
  expect(i).toBeGreaterThanOrEqual(0);
  const wrong = options.nth((i + 1) % 4);
  await wrong.click();
  await expect(wrong).toHaveCSS("background-color", await tokenBg(page, "--highlight")); // selected, not checked yet
  await q.getByRole("button", { name: "Check" }).click();
  await expect(page.getByTestId("feedback")).toBeVisible();
  await expect(wrong).toHaveAttribute("data-state", "wrong");
  await expect(wrong).toHaveCSS("background-color", await tokenBg(page, "--danger"));
  await expect(options.nth(i)).toHaveAttribute("data-state", "right");
  await expect(options.nth(i)).toHaveCSS("background-color", await tokenBg(page, "--success"));

  // Dark theme too.
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await expect(wrong).toHaveCSS("background-color", await tokenBg(page, "--danger"));
  await expect(options.nth(i)).toHaveCSS("background-color", await tokenBg(page, "--success"));
  await page.evaluate(() => document.documentElement.removeAttribute("data-theme"));

  // Finish with "I don't know" and look at the results' next steps.
  for (;;) {
    const next = page.getByTestId("feedback").getByRole("button", { name: /^(Next question|See results)$/ });
    const label = await next.textContent();
    await next.click();
    if (label === "See results") break;
    await page.getByTestId("question").getByRole("button", { name: "I don't know" }).click();
  }
  await expect(page.getByTestId("score")).toBeVisible();
  await expect(page.getByRole("button", { name: "Start a focus round" })).toBeVisible();
  await expect(page.getByRole("link", { name: "← Quizzes" })).toBeVisible();

  // The subject page with weak topics, at 375 px: no sideways scroll (P1-2).
  await page.getByRole("link", { name: "← Quizzes" }).click();
  await page.getByRole("link", { name: "← Biology", exact: true }).click();
  await expect(page.getByTestId("weak-strip")).toBeVisible();
  await page.setViewportSize({ width: 375, height: 760 });
  await expectNoHorizontalScroll(page);
  if (isMobile) expect(await smallTargets(page)).toEqual([]);
  await expectNoA11yViolations(page);
});

test("Settings theme is a segmented control with a visible keyboard focus ring", async ({ page, isMobile }) => {
  test.skip(isMobile, "keyboard focus");
  await startDemo(page);
  await openSettings(page);
  const group = page.getByRole("radiogroup", { name: "Theme" });
  await expect(group).toHaveClass(/\bseg\b/);
  await group.getByRole("radio", { name: "Light" }).focus();
  await page.keyboard.press("ArrowRight"); // keyboard focus (:focus-visible) on "Dark"
  const label = group.locator("label", { hasText: "Dark" });
  await expect(label).toHaveCSS("outline-style", "solid");
  await expect(label).toHaveCSS("outline-width", "3px");
  await page.getByRole("radiogroup", { name: "Theme" }).getByRole("radio", { name: "Match my device" }).check({ force: true });
});

test("44 px targets on Settings and Privacy at 375 px", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Touch targets.");
  await page.setViewportSize({ width: 375, height: 760 });
  await startDemo(page);
  await openSettings(page);
  await expectNoHorizontalScroll(page);
  // The volume slider is an input (only its height counts) and is checked by its own spec.
  expect((await smallTargets(page)).filter((t) => !t.startsWith('input "'))).toEqual([]);
  await page.goto("/privacy");
  expect(await smallTargets(page)).toEqual([]);
});

test("landing page: everything it lists is built (no 'Coming soon')", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Coming soon")).toHaveCount(0);
  for (const h of ["A folder per subject", "Flashcards that come back", "Quizzes on your weak spots", "Focus timer and timetable"]) {
    await expect(page.getByRole("heading", { name: h })).toBeVisible();
  }
  await expect(page.getByText("Pomodoro rounds per subject, your classes, and a link for your calendar.")).toBeVisible();
});

test("phone mindmap opens readable (zoom at least 0.7) with the Outline tip", async ({ page, isMobile }) => {
  test.skip(!isMobile, "Phone layout.");
  await page.setViewportSize({ width: 375, height: 760 });
  await startDemo(page);
  await createSubject(page, "Physics");
  await page.getByRole("link", { name: /Physics/ }).click();
  await writeNote(page, "Physics");
  await page.getByRole("link", { name: /^Mindmap/ }).click();
  await page.getByRole("button", { name: "Make a mindmap" }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("outline-tip")).toHaveText("Tip: Outline is easier to read on a phone.");
  const scale = () => page.locator(".react-flow__viewport").evaluate((el) => new DOMMatrix(getComputedStyle(el).transform).a);
  await expect.poll(scale).toBeGreaterThanOrEqual(0.7);
  // The root sits in view.
  const root = page.locator(".mm-root").first();
  await expect(root).toBeInViewport();
  await expectNoHorizontalScroll(page);
});

test("Open on a file row opens a new tab, or downloads here when a popup blocker refuses the tab", async ({ page }) => {
  await startDemo(page);
  await createSubject(page, "Anatomy");
  await page.getByRole("link", { name: /Anatomy/ }).click();
  await page.locator("#file-input").setInputFiles(path.join(__dirname, "fixtures", "heart.pdf"));
  await expect(page.getByText("Ready · 2 pages")).toBeVisible({ timeout: 15_000 });

  const popup = page.waitForEvent("popup");
  await rowAction(page, "heart.pdf", "Open", "Open heart.pdf");
  const tab = await popup;
  expect(await tab.evaluate(() => window.opener)).toBeNull();
  await tab.close();

  // Safari and iOS refuse window.open after the server round trip: the file downloads in this tab instead.
  const here = page.url();
  await page.evaluate(() => { window.open = () => null; });
  const download = page.waitForEvent("download");
  await rowAction(page, "heart.pdf", "Open", "Open heart.pdf");
  expect((await download).suggestedFilename()).toBe("heart.pdf");
  expect(page.url()).toBe(here);
  await expect(page.getByRole("heading", { level: 1, name: "Anatomy" })).toBeVisible();
});
