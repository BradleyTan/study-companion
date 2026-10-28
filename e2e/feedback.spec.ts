import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, startDemo } from "./helpers";

// Student test feedback (2026-10-28): study notes, detailed mindmaps. Demo mode has no AI key,
// so the deterministic local generator writes the notes and the map.
const NOTE = [
  "Osmosis is the movement of water across a partially permeable membrane.",
  "Water moves from a dilute solution to a more concentrated solution.",
  "Diffusion is the net movement of particles from high to low concentration.",
  "Active transport uses energy from ATP to move ions against a gradient.",
  "The sodium-potassium pump moves 3 sodium ions out and 2 potassium ions in.",
].join(" ");

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
}

test("make study notes from a note, then open them as a new note", async ({ page }) => {
  await subjectWithNote(page, "Biology");
  await page.getByTestId("make-notes").first().click();
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("heading", { name: "Make study notes" })).toBeVisible();
  await expect(dialog.getByTestId("quota-chip")).toHaveText("5 of 5 left today");
  await dialog.getByRole("radio", { name: /Membrane transport/ }).check();
  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);
  await dialog.getByRole("button", { name: "Make notes" }).click();
  await expect(dialog.getByRole("heading", { name: /Your notes are ready/ })).toBeVisible({ timeout: 15_000 });
  await expect(dialog.getByTestId("notes-made")).toContainText("Study notes: Membrane transport");
  await expect(dialog.getByTestId("quota-chip")).toHaveText("4 of 5 left today");
  await expectNoA11yViolations(page);
  await dialog.getByRole("link", { name: "Open notes" }).click();
  await expect(page).toHaveURL(/\/notes\//);
  await expect(page.getByLabel("Title")).toHaveValue("Study notes: Membrane transport");
  const editor = page.getByRole("textbox", { name: "Note text" });
  await expect(editor).toContainText("Study notes made from Membrane transport");
  await expect(editor.locator("h2").first()).toBeVisible();
  await expect(editor.locator("li").first()).toContainText("Osmosis is the movement of water");
  await expect(editor).toContainText("Key terms");
});

test("a web link that can't be opened says why and uses no go", async ({ page }) => {
  await subjectWithNote(page, "Chemistry");
  await page.getByTestId("make-notes").first().click();
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("button", { name: "A web page" }).click();
  // Empty link: inline error, nothing sent.
  await dialog.getByRole("button", { name: "Make notes" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Paste a link to a web page.");
  await dialog.getByLabel("Link to a web page").fill("http://localhost:3000/secret");
  await dialog.getByRole("button", { name: "Make notes" }).click();
  await expect(dialog.getByText("That link can't be opened from StudyNest. Try a public web page.")).toBeVisible();
  await expect(dialog.getByTestId("quota-chip")).toHaveText("5 of 5 left today");
  await expectNoA11yViolations(page);
  await dialog.getByRole("button", { name: "Back" }).click();
  await expect(dialog.getByLabel("Link to a web page")).toHaveValue("http://localhost:3000/secret");
});

test("the mindmap shows each topic's detail on the map, in the outline and in the panel", async ({ page }) => {
  await subjectWithNote(page, "Physiology");
  await page.getByRole("link", { name: /^Mindmap/ }).click();
  await page.getByRole("button", { name: "Make a mindmap" }).click();
  await expect(page.locator(".mm-detail").first()).toBeVisible({ timeout: 20_000 });
  await expect(page.locator(".mm-detail").first()).toContainText(/\w+/);
  await expectNoHorizontalScroll(page);
  // Hide and show details on the map (remembered on this device).
  await page.getByRole("button", { name: "More mindmap actions" }).click();
  await page.getByRole("button", { name: "Hide details on map" }).click();
  await expect(page.locator(".mm-detail")).toHaveCount(0);
  await page.getByRole("button", { name: "More mindmap actions" }).click();
  await page.getByRole("button", { name: "Show details on map" }).click();
  await expect(page.locator(".mm-detail").first()).toBeVisible();
  // Outline: details under each topic; the panel leads with the detail.
  await page.getByRole("button", { name: "Outline" }).click();
  await expect(page.getByTestId("outline-detail").first()).toBeVisible();
  await page.getByRole("button", { name: /^Show passage/ }).first().click();
  await expect(page.getByTestId("panel-detail")).toBeVisible();
  await expectNoA11yViolations(page);
});

test("read aloud: the voice picker and the online-voice hint never overlap", async ({ page }) => {
  // Bradley's screenshot (2026-10-28): with an online voice the hint squeezed the voice picker to nothing.
  await page.addInitScript(() => {
    const voices = [
      { name: "Microsoft Ava Online (Natural) - English (United States)", lang: "en-US", voiceURI: "ava", localService: false, default: true },
      { name: "Google UK English Female", lang: "en-GB", voiceURI: "uk", localService: true, default: false },
    ];
    const synth = { speaking: false, paused: false, pending: false, getVoices: () => voices, speak: () => {}, cancel: () => {}, pause: () => {}, resume: () => {}, addEventListener: () => {}, removeEventListener: () => {} };
    Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
    Object.defineProperty(window, "SpeechSynthesisUtterance", { value: class { constructor(public text: string) {} }, configurable: true });
  });
  await subjectWithNote(page, "Networking");
  await page.getByRole("link", { name: /Membrane transport/ }).click();
  await page.getByRole("button", { name: "Read aloud" }).click();
  const bar = page.getByRole("region", { name: "Read aloud" });
  const voice = bar.getByLabel("Voice");
  const hint = bar.getByText("Online voices send the text");
  await expect(hint).toBeVisible();
  const [v, h] = [(await voice.boundingBox())!, (await hint.boundingBox())!];
  expect(v.width).toBeGreaterThan(150);
  const overlaps = v.x < h.x + h.width && h.x < v.x + v.width && v.y < h.y + h.height && h.y < v.y + v.height;
  expect(overlaps).toBe(false);
  await expectNoHorizontalScroll(page);
});
