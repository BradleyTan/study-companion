import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, startDemo } from "./helpers";

// QA for the student-test feedback branch (docs/qa/feedback.md): Make study notes at 375 px, in
// dark mode, by keyboard only, with sound off, from a long file's page range; mindmap outline
// details on a phone. Demo mode: the deterministic local generator writes the notes and the map.
const NOTE = [
  "Osmosis is the movement of water across a partially permeable membrane.",
  "Water moves from a dilute solution to a more concentrated solution.",
  "Diffusion is the net movement of particles from high to low concentration.",
  "Active transport uses energy from ATP to move ions against a gradient.",
  "The sodium-potassium pump moves 3 sodium ions out and 2 potassium ions in.",
].join(" ");

/** Counts Web Audio tones started (every UI sound is an oscillator or a noise buffer). */
async function spyOnSounds(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __tones: number };
    w.__tones = 0;
    const proto = AudioContext.prototype;
    const osc = proto.createOscillator;
    const buf = proto.createBufferSource;
    proto.createOscillator = function (this: AudioContext) { w.__tones++; return osc.call(this); };
    proto.createBufferSource = function (this: AudioContext) { w.__tones++; return buf.call(this); };
  });
}
const tones = (page: Page) => page.evaluate(() => (window as unknown as { __tones: number }).__tones);

async function subjectWithNote(page: Page, subject: string) {
  await startDemo(page);
  await createSubject(page, subject);
  await page.getByRole("link", { name: new RegExp(subject) }).click();
  await page.getByRole("button", { name: "+ Write a note" }).first().click();
  await expect(page).toHaveURL(/\/notes\//);
  await page.getByLabel("Title").fill("Membrane transport");
  await page.getByRole("textbox", { name: "Note text" }).click();
  await page.keyboard.insertText(NOTE);
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
  await page.goto(page.url().replace(/\/notes\/.*$/, ""));
  await expect(page.getByTestId("make-notes")).toBeVisible();
}

test.describe("phone, 375 px, dark mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await page.emulateMedia({ colorScheme: "dark" });
  });

  test("Make notes: header buttons, both tabs, a message and the ready step fit with no sideways scroll", async ({ page }) => {
    await subjectWithNote(page, "Biology");
    // Phone: the two buttons sit on one row under the "Notes" heading.
    const make = page.getByTestId("make-notes");
    const add = page.getByRole("button", { name: "+ New note" });
    const [mb, ab, hb] = await Promise.all([make.boundingBox(), add.boundingBox(), page.getByRole("heading", { name: "Notes", exact: true }).boundingBox()]);
    expect(Math.abs(mb!.y - ab!.y)).toBeLessThan(4);
    expect(mb!.y).toBeGreaterThan(hb!.y);
    expect(mb!.height).toBeGreaterThanOrEqual(44);
    await expectNoHorizontalScroll(page);

    await make.click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog.getByRole("heading", { name: "Make study notes" })).toBeVisible();
    const box = await dialog.boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    await expect(dialog.getByRole("group", { name: "Make notes from" }).getByRole("button", { name: "My notes & files" })).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByRole("button", { name: "Make notes" })).toBeDisabled();
    await expectNoHorizontalScroll(page);
    await expectNoA11yViolations(page);

    // Web tab: field focused, error wiring, message, Back keeps the link.
    await dialog.getByRole("button", { name: "A web page" }).click();
    const url = dialog.getByLabel("Link to a web page");
    await expect(url).toBeFocused();
    await expect(url).toHaveAttribute("type", "url");
    await expect(url).toHaveAttribute("placeholder", "https://en.wikipedia.org/wiki/Osmosis");
    await dialog.getByRole("button", { name: "Make notes" }).click();
    await expect(url).toHaveAttribute("aria-invalid", "true");
    await expect(url).toBeFocused();
    const describedBy = (await url.getAttribute("aria-describedby"))!.split(" ");
    expect(describedBy).toHaveLength(2);
    await expect(dialog.locator(`[id="${describedBy[1]}"]`)).toHaveText("Paste a link to a web page.");
    await url.fill("not a link at all");
    await expect(url).not.toHaveAttribute("aria-invalid", "true");
    await dialog.getByRole("button", { name: "Make notes" }).click();
    await expect(dialog.getByText(/That doesn.t look like a web link\./)).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Make study notes" })).toBeFocused();
    await expectNoHorizontalScroll(page);
    await expectNoA11yViolations(page);
    await dialog.getByRole("button", { name: "Back" }).click();
    await expect(dialog.getByLabel("Link to a web page")).toHaveValue("not a link at all");

    // Back to my notes: make them; the ready step fits too.
    await dialog.getByRole("button", { name: "My notes & files" }).click();
    await dialog.getByRole("radio", { name: /Membrane transport/ }).check();
    await dialog.getByRole("button", { name: "Make notes" }).click();
    const ready = dialog.getByRole("heading", { name: /Your notes are ready/ });
    await expect(ready).toBeVisible({ timeout: 15_000 });
    await expect(ready).toBeFocused();
    await expect(dialog.getByTestId("notes-made")).toContainText(/\d+ key points? and \d+ key terms?, saved as a new note\./);
    await expectNoHorizontalScroll(page);
    await expectNoA11yViolations(page);
    await dialog.getByRole("button", { name: "Done" }).click();
    await expect(dialog).toHaveCount(0);
    // The new note is in the list.
    await expect(page.getByRole("link", { name: /Study notes: Membrane transport/ })).toBeVisible();
  });

  test("mindmap outline shows each topic's detail on a phone without sideways scroll", async ({ page }) => {
    await subjectWithNote(page, "Physiology");
    await page.getByRole("link", { name: /^Mindmap/ }).click();
    await page.getByRole("button", { name: "Make a mindmap" }).click();
    await expect(page.locator(".mm-detail").first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Outline" }).click();
    const detail = page.getByTestId("outline-detail").first();
    await expect(detail).toBeVisible();
    await expect(detail).toContainText(/\w{3,}/);
    const b = await detail.boundingBox();
    expect(b!.x + b!.width).toBeLessThanOrEqual(375);
    await expectNoHorizontalScroll(page);
    // Hide/Show details is a map option only.
    await page.getByRole("button", { name: "More mindmap actions" }).click();
    await expect(page.getByRole("button", { name: /details on map/ })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /^Show passage/ }).first().click();
    const panel = page.getByTestId("panel-detail");
    await expect(panel).toBeVisible();
    const pb = await panel.boundingBox();
    expect(pb!.x + pb!.width).toBeLessThanOrEqual(375);
    await expectNoA11yViolations(page);
  });
});

test("keyboard only: open, pick a note, make notes, focus lands on the result, Esc closes", async ({ page }) => {
  await subjectWithNote(page, "Chemistry");
  await page.getByTestId("make-notes").focus();
  await page.keyboard.press("Enter");
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("heading", { name: "Make study notes" })).toBeVisible();
  const radio = dialog.getByRole("radio", { name: /Membrane transport/ });
  // Tab through the dialog until the note's radio has focus (focus stays trapped in the dialog).
  for (let i = 0; i < 12 && !(await radio.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog[open]"))).toBe(true);
  }
  await expect(radio).toBeFocused();
  await page.keyboard.press("Space");
  await expect(radio).toBeChecked();
  const submit = dialog.getByRole("button", { name: "Make notes" });
  for (let i = 0; i < 8 && !(await submit.evaluate((el) => el === document.activeElement)); i++) await page.keyboard.press("Tab");
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");
  const ready = dialog.getByRole("heading", { name: /Your notes are ready/ });
  await expect(ready).toBeFocused({ timeout: 15_000 });
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus")).toHaveText(/Done|Open notes/);
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});

test.describe("sounds", () => {
  test("with sounds on, the dialog clicks and pops; with sounds off, it makes no sound at all", async ({ page }) => {
    await spyOnSounds(page);
    await subjectWithNote(page, "Physics");
    await page.getByTestId("make-notes").click();
    const dialog = page.locator("dialog[open]");
    await dialog.getByRole("radio", { name: /Membrane transport/ }).check();
    await dialog.getByRole("button", { name: "Make notes" }).click();
    await expect(dialog.getByRole("heading", { name: /Your notes are ready/ })).toBeVisible({ timeout: 15_000 });
    expect(await tones(page)).toBeGreaterThan(0);
    await dialog.getByRole("button", { name: "Done" }).click();

    // Sounds off in settings.
    await page.goto("/settings");
    await page.getByLabel("Play sounds").uncheck();
    await expect(page.getByLabel("Play sounds")).not.toBeChecked();
    await page.goBack();
    await page.reload();
    await expect(page.getByTestId("make-notes")).toBeVisible();
    const before = await tones(page);
    await page.getByTestId("make-notes").click();
    await dialog.getByRole("button", { name: "A web page" }).click();
    await dialog.getByRole("button", { name: "Make notes" }).click(); // empty: boop, muted
    await expect(dialog.getByRole("alert")).toHaveText("Paste a link to a web page.");
    await dialog.getByRole("button", { name: "My notes & files" }).click();
    await dialog.getByRole("radio", { name: /^Membrane transport/ }).check();
    await dialog.getByRole("button", { name: "Make notes" }).click();
    await expect(dialog.getByRole("heading", { name: /Your notes are ready/ })).toBeVisible({ timeout: 15_000 });
    expect(await tones(page)).toBe(before);
  });
});

test("long file: the page-range fields show in the notes dialog; the note says which pages; a wide range is sampled", async ({ page }) => {
  await startDemo(page);
  await createSubject(page, "Neuroscience");
  await page.getByRole("link", { name: /Neuroscience/ }).click();
  await page.locator("#file-input").setInputFiles(path.join(__dirname, "fixtures", "very-long-lecture.pdf"));
  await expect(page.getByText("Ready · 60 pages")).toBeVisible({ timeout: 20_000 });
  // No notes yet: the empty box offers Make notes, and the dialog opens on My notes & files (there's a file).
  await expect(page.getByText("No notes yet. Type your first one, or let us make notes from your lecture files or a web page.")).toBeVisible();
  await page.getByTestId("make-notes").click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("button", { name: "My notes & files" })).toHaveAttribute("aria-pressed", "true");
  await dialog.getByRole("radio", { name: /^very-long-lecture\.pdf/ }).check();
  await expect(dialog.getByText("Long file: notes are made a few pages at a time.")).toBeVisible();
  const first = dialog.getByLabel("First page");
  const last = dialog.getByLabel("Last page");
  await expect(first).toHaveValue("1");
  // ~2,450 characters a page, 10,000 a set: best fit is 4 pages.
  await expect(last).toHaveValue("4");
  await expect(dialog.getByTestId("range-hint")).toContainText("Covers every passage on pages 1–4.");
  await dialog.getByRole("group", { name: "Quick pick for pages" }).getByRole("button", { name: "50 pages: pages 1 to 50" }).click();
  await expect(dialog.getByTestId("range-hint")).toContainText("Notes will be spread across pages 1–50, a quick tour of the lot.");
  // Over 50 pages: inline error, nothing sent.
  await last.fill("55");
  await dialog.getByRole("button", { name: "Make notes" }).click();
  await expect(dialog.getByText("Up to 50 pages at a time.")).toBeVisible();
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-invalid", "true");
  await expectNoA11yViolations(page);
  await last.fill("4");
  await dialog.getByRole("button", { name: "Make notes" }).click();
  await expect(dialog.getByRole("heading", { name: /Your notes are ready/ })).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("It was a lot of text", { exact: false })).toHaveCount(0);
  await dialog.getByRole("link", { name: "Open notes" }).click();
  await expect(page.getByRole("textbox", { name: "Note text" })).toContainText("Study notes made from very-long-lecture.pdf, pages 1–4.");
  await page.goBack();

  // 1–50: a quick sample, said on the ready step; the quota went down by one each time.
  await page.getByTestId("make-notes").click();
  await dialog.getByRole("radio", { name: /^very-long-lecture\.pdf/ }).check();
  await dialog.getByLabel("First page").fill("1");
  await dialog.getByLabel("Last page").fill("50");
  await dialog.getByRole("button", { name: "Make notes" }).click();
  await expect(dialog.getByRole("heading", { name: /Your notes are ready/ })).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByText("It was a lot of text, so the notes cover it evenly. For fuller notes, make them a few pages at a time.")).toBeVisible();
  await expect(dialog.getByTestId("quota-chip")).toHaveText("3 of 5 left today");
});

test("a subject with nothing in it opens the dialog on the web page tab", async ({ page }) => {
  await startDemo(page);
  await createSubject(page, "History");
  await page.getByRole("link", { name: /History/ }).click();
  await page.getByTestId("make-notes").click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("button", { name: "A web page" })).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.getByLabel("Link to a web page")).toBeVisible();
  await dialog.getByRole("button", { name: "My notes & files" }).click();
  await expect(dialog.getByText("Add a note or a lecture file first, or make notes from a web page.")).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
});
