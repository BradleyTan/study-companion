import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, smallTargets, startDemo } from "./helpers";

// QA regression checks for Step 2 (docs/qa/step-2.md). Demo mode: the local generator makes the cards.
const NOTE = Array.from({ length: 24 }, (_, i) =>
  `Fact number ${i + 1} says that enzyme ${String.fromCharCode(65 + (i % 26))}${i} speeds up reaction ${i + 1} inside the cell.`).join(" ");

async function subjectWithNote(page: Page, subject: string, title = "Enzymes", text = NOTE) {
  await startDemo(page);
  await createSubject(page, subject);
  await page.getByRole("link", { name: new RegExp(subject) }).click();
  await page.getByRole("button", { name: "+ Write a note" }).first().click();
  await expect(page).toHaveURL(/\/notes\//);
  await page.getByLabel("Title").fill(title);
  await page.getByRole("textbox", { name: "Note text" }).click();
  await page.keyboard.insertText(text);
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
}

async function makeCards(page: Page, count: 10 | 15 | 20 = 10) {
  await page.getByRole("button", { name: /Make flashcards/ }).click();
  const dialog = page.locator("dialog[open]");
  if (count !== 10) await dialog.getByRole("radio", { name: String(count) }).check({ force: true });
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(dialog.getByRole("heading", { name: /new cards?!/ })).toBeVisible({ timeout: 15_000 });
  return dialog;
}

/** Visible controls smaller than 44 × 44 px (inline text links excepted). */
test("a double tap on a grade doesn't flip the next card", async ({ page }) => {
  await subjectWithNote(page, "Biochem");
  const dialog = await makeCards(page);
  await dialog.getByRole("link", { name: "Start reviewing" }).click();
  await page.getByRole("button", { name: /^Show answer/ }).click();
  const good = page.getByRole("button", { name: /^Good, next review/ });
  const box = (await good.boundingBox())!;
  await page.mouse.dblclick(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("progress-text")).toHaveText(/^1 done/);
  await expect(page.getByRole("button", { name: /^Show answer/ })).toBeVisible();
  await expect(page.getByRole("group", { name: "How well did you remember it?" })).toBeHidden();
});

test("many cards: Again comes back, rapid Undo rolls back every grade on the server too", async ({ page, context }) => {
  await subjectWithNote(page, "Genetics");
  const dialog = await makeCards(page, 20);
  await dialog.getByRole("link", { name: "Start reviewing" }).click();
  const progress = page.getByTestId("progress-text");
  const initial = (await progress.textContent())!;
  const total = Number(/(\d+) to go/.exec(initial)![1]);
  expect(total).toBeGreaterThan(10);

  // Again keeps the card in the session; Good on a new card does too (it's still learning).
  const grades = ["1", "3", "1", "2", "4"];
  for (const key of grades) {
    await page.getByRole("button", { name: /^Show answer/ }).waitFor();
    await page.keyboard.press("Space");
    await page.getByRole("group", { name: "How well did you remember it?" }).waitFor();
    await page.keyboard.press(key);
  }
  await expect(progress).toHaveText(`5 done · ${total - 1} to go`); // only Easy left the session
  for (let i = 0; i < grades.length; i++) await page.keyboard.press("u");
  await expect(progress).toHaveText(initial);

  // The server agrees: a fresh page starts the same session again.
  await expect.poll(async () => {
    const fresh = await context.newPage();
    await fresh.goto(page.url());
    const text = await fresh.getByTestId("progress-text").textContent();
    await fresh.close();
    return text;
  }, { timeout: 15_000 }).toBe(initial);
});

test("mindmap: a moved topic stays put after reload, and Reset layout puts it back", async ({ page }) => {
  await subjectWithNote(page, "Ecology");
  const subjectUrl = page.url().replace(/\/notes\/.*$/, "");
  await page.goto(`${subjectUrl}/mindmap`);
  await page.getByRole("button", { name: "Make a mindmap" }).click();
  const topic = page.locator('.react-flow__node[data-id="n1"]');
  await expect(topic).toBeVisible({ timeout: 15_000 });
  const gotIt = page.getByRole("button", { name: "Got it" });
  if (await gotIt.isVisible()) await gotIt.click();
  const before = await topic.evaluate((el) => (el as HTMLElement).style.transform);
  await topic.focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowDown");
  await expect(page.getByTestId("layout-save")).toHaveText("Saved ✓", { timeout: 5000 });
  const moved = await topic.evaluate((el) => (el as HTMLElement).style.transform);
  expect(moved).not.toBe(before);

  await page.reload();
  await expect(topic).toBeVisible();
  await expect.poll(() => topic.evaluate((el) => (el as HTMLElement).style.transform)).toBe(moved);

  await page.getByRole("button", { name: "More mindmap actions" }).click();
  await page.getByRole("menuitem", { name: "Reset layout" }).or(page.getByRole("button", { name: "Reset layout" })).first().click();
  await expect.poll(() => topic.evaluate((el) => (el as HTMLElement).style.transform)).toBe(before);
  await page.reload();
  await expect.poll(() => topic.evaluate((el) => (el as HTMLElement).style.transform)).toBe(before);
});

test("a card's source link after its note was rewritten shows the 'passage has changed' banner", async ({ page }) => {
  await subjectWithNote(page, "Zoology");
  const dialog = await makeCards(page);
  await dialog.getByRole("button", { name: "Done" }).click();
  const noteUrl = page.url().split("?")[0];
  const subjectUrl = noteUrl.replace(/\/notes\/.*$/, "");

  // Rewrite the whole note.
  await page.getByRole("textbox", { name: "Note text" }).click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.insertText("Completely different notes about penguins and their colonies on the ice.");
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });

  await page.goto(`${subjectUrl}/flashcards`);
  const href = await page.getByRole("list", { name: "Cards" }).getByRole("article").first().getByRole("link", { name: "Enzymes" }).getAttribute("href");
  await page.goto(href!);
  await expect(page.getByText("This passage has changed since the card was made.")).toBeVisible();
  await expect(page.getByTestId("passage-mark")).toHaveCount(0);
  await expectNoA11yViolations(page);
});

test("dark mode and reduced motion: Step 2 screens pass axe", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await subjectWithNote(page, "Optics");
  const dialog = await makeCards(page);
  await expectNoA11yViolations(page);
  await dialog.getByRole("button", { name: "Done" }).click();
  const subjectUrl = page.url().replace(/\/notes\/.*$/, "");
  await page.goto(`${subjectUrl}/flashcards`);
  await expect(page.getByRole("list", { name: "Cards" })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto(`${subjectUrl}/review`);
  await page.getByRole("button", { name: /^Show answer/ }).click();
  await expect(page.getByRole("group", { name: "How well did you remember it?" })).toBeVisible();
  await expectNoA11yViolations(page);
  await page.goto(`${subjectUrl}/mindmap`);
  await page.getByRole("button", { name: "Make a mindmap" }).click();
  await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 15_000 });
  const gotIt = page.getByRole("button", { name: "Got it" });
  if (await gotIt.isVisible()) await gotIt.click();
  await expectNoA11yViolations(page);
  await page.getByRole("button", { name: "Outline" }).click();
  await expect(page.getByRole("tree")).toBeVisible();
  await expectNoA11yViolations(page);
});

test.describe("at 375 px on a touch screen", () => {
  test.use({ viewport: { width: 375, height: 740 }, hasTouch: true, isMobile: true });

  test("Step 2 screens: no sideways scroll and 44 px touch targets", async ({ page }) => {
    await subjectWithNote(page, "Botany");
    const dialog = await makeCards(page);
    expect(await smallTargets(page)).toEqual([]);
    await dialog.getByRole("button", { name: "Done" }).click();
    const subjectUrl = page.url().replace(/\/notes\/.*$/, "");
    for (const path of ["", "/flashcards", "/review"]) {
      await page.goto(subjectUrl + path);
      await page.locator("main").waitFor();
      await expectNoHorizontalScroll(page);
      expect(await smallTargets(page), path || "subject").toEqual([]);
    }
    await page.getByRole("button", { name: /^Show answer/ }).click();
    await expect(page.getByRole("group", { name: "How well did you remember it?" })).toBeVisible();
    // Polled: the card is still turning over, and the back face's "From …" link (44 px tall since
    // the polish pass, so now measured) reads narrow mid-flip.
    await expect.poll(() => smallTargets(page)).toEqual([]);
    await page.goto(`${subjectUrl}/mindmap`);
    await page.getByRole("button", { name: "Make a mindmap" }).click();
    await expect(page.locator(".react-flow__node").first()).toBeVisible({ timeout: 15_000 });
    const gotIt = page.getByRole("button", { name: "Got it" });
    if (await gotIt.isVisible()) await gotIt.click();
    await expectNoHorizontalScroll(page);
    expect(await smallTargets(page)).toEqual([]);
  });
});

/** Fake speechSynthesis: `voices` = how many voices the device has; null = no Web Speech at all. */
async function stubSpeech(page: Page, voices: number | null) {
  await page.addInitScript((n) => {
    const w = window as unknown as Record<string, unknown>;
    if (n === null) { delete w.speechSynthesis; delete w.SpeechSynthesisUtterance; Object.defineProperty(window, "speechSynthesis", { value: undefined, configurable: true }); return; }
    const spoken: string[] = [];
    let current: { onend?: () => void } | null = null;
    w.__spoken = spoken;
    w.__finishSentence = () => { const u = current; current = null; u?.onend?.(); };
    class Utterance { text: string; rate = 1; lang = ""; voice: unknown = null; onend?: () => void; onerror?: () => void; constructor(t: string) { this.text = t; } }
    const list = Array.from({ length: n }, (_, i) => ({ name: `Voice ${i}`, lang: "en-GB", voiceURI: `v${i}`, localService: true, default: i === 0 }));
    const synth = {
      speaking: false, paused: false, pending: false, getVoices: () => list,
      speak: (u: Utterance) => { spoken.push(u.text); current = u; }, cancel: () => { current = null; },
      pause: () => {}, resume: () => {}, addEventListener: () => {}, removeEventListener: () => {},
    };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: Utterance, configurable: true });
  }, voices);
}

test("read aloud: Resume starts the paused sentence again", async ({ page }) => {
  await stubSpeech(page, 1);
  await subjectWithNote(page, "Latin", "Verbs");
  await page.getByRole("button", { name: "Read aloud" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  await page.keyboard.press("Control+Home");
  await bar.getByRole("button", { name: "▶ Play" }).click();
  await page.evaluate(() => (window as unknown as { __finishSentence: () => void }).__finishSentence());
  await expect(bar.getByTestId("read-aloud-status")).toHaveText(/Reading sentence 2 of/);
  await bar.getByRole("button", { name: "❚❚ Pause" }).click();
  await bar.getByRole("button", { name: "▶ Play" }).click();
  await expect(bar.getByTestId("read-aloud-status")).toHaveText(/Reading sentence 2 of/);
  const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken);
  expect(spoken).toHaveLength(3);
  expect(spoken[2]).toBe(spoken[1]);
});

for (const [name, voices, text] of [
  ["no voices installed", 0, "Your device has no reading voices installed."],
  ["no Web Speech at all", null, "Read aloud isn't available in this browser."],
] as const) {
  test(`read aloud with ${name} explains why and can't start`, async ({ page }) => {
    await stubSpeech(page, voices);
    await subjectWithNote(page, "Music", "Scales");
    await page.getByRole("button", { name: "Read aloud" }).click();
    const bar = page.getByRole("region", { name: "Read aloud" });
    await expect(bar.getByTestId("read-aloud-status")).toContainText(text, { timeout: 5000 });
    await expect(bar.getByRole("button", { name: "▶ Play" })).toBeDisabled();
    await expectNoA11yViolations(page);
  });
}

// QA step 3 (docs/qa/step-3.md): the refresh after making a mindmap used to remount the whole
// screen when it landed (the page keyed it on the map's createdAt), closing the passage panel and
// dropping a layout save still waiting to be sent. In a busy full e2e run the refresh lands seconds
// late, so step2.spec.ts "mindmap: make, open a passage, move a topic" failed now and then.
test("mindmap: a late refresh after making it keeps the open passage and the layout save", async ({ page }) => {
  await subjectWithNote(page, "Geology");
  const subjectUrl = page.url().replace(/\/notes\/.*$/, "");
  await page.goto(`${subjectUrl}/mindmap`);
  await expect(page.getByRole("button", { name: "Make a mindmap" })).toBeVisible();
  // From now on, hold back every page refresh (RSC GET) by 3 s, like a busy server.
  let held = 0;
  await page.route(/\/mindmap/, async (route) => {
    const req = route.request();
    if (req.method() === "GET" && req.headers()["rsc"]) {
      held++;
      await new Promise((r) => setTimeout(r, 3000));
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Make a mindmap" }).click();
  const topic = page.locator('.react-flow__node[data-id="n1"]');
  await expect(topic).toBeVisible({ timeout: 15_000 });
  const gotIt = page.getByRole("button", { name: "Got it" });
  if (await gotIt.isVisible()) await gotIt.click(); // touch hint (phones), set when the screen mounted

  // Open a passage and move a topic while the refresh is still on its way.
  await topic.focus();
  await page.keyboard.press("Enter");
  const panel = page.getByTestId("passage-panel");
  await expect(panel.getByRole("heading")).toBeVisible();
  await panel.getByRole("button", { name: "Close" }).click();
  await topic.focus();
  await page.keyboard.press("Shift+ArrowRight");
  await page.keyboard.press("Enter");
  await expect(panel.getByRole("heading")).toBeVisible();
  await expect.poll(() => held).toBeGreaterThan(0);
  // After the refresh has landed, the panel is still open and the move was saved.
  await page.waitForTimeout(3500);
  await expect(panel.getByRole("heading")).toBeVisible();
  await expect(page.getByTestId("quota-chip").first()).toHaveText("2 of 3 left today");
  await page.unroute(/\/mindmap/);
  const moved = await topic.evaluate((el) => (el as HTMLElement).style.transform);
  await page.reload();
  await expect(topic).toBeVisible();
  await expect.poll(() => topic.evaluate((el) => (el as HTMLElement).style.transform)).toBe(moved);
});
