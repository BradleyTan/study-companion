import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import JSZip from "jszip";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, startDemo } from "./helpers";

// QA for note downloads, toolbar headings that survive a save, the mindmap's notes-changed
// banner and the read-aloud voice picker (docs/qa/note-download.md). Demo mode.

async function newNote(page: Page, subject: string) {
  await startDemo(page);
  await createSubject(page, subject);
  await page.getByRole("link", { name: new RegExp(subject) }).click();
  await page.getByRole("button", { name: "+ Write a note" }).first().click();
  await expect(page).toHaveURL(/\/notes\//);
  await expect(page.getByRole("toolbar", { name: "Formatting" })).toBeVisible();
}

const editor = (page: Page) => page.getByRole("textbox", { name: "Note text" });
const tool = (page: Page, name: string) => page.getByRole("toolbar", { name: "Formatting" }).getByRole("button", { name, exact: true });

/** A heading, a numbered list with a nested list, a bullet list with a nested item, bold and odd characters, all from the toolbar. */
async function writeStructuredNote(page: Page) {
  await editor(page).click();
  await tool(page, "Heading").click();
  await page.keyboard.insertText("Long-term causes");
  await page.keyboard.press("Enter");
  await tool(page, "Numbered list").click();
  await page.keyboard.insertText("Alliances");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("Triple Entente");
  await page.keyboard.press("Enter");
  await page.keyboard.insertText("Triple Alliance");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.insertText("Militarism");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await tool(page, "Bullet list").click();
  await page.keyboard.insertText("Naval race");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await page.keyboard.insertText("Dreadnoughts");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await tool(page, "Bold").click();
  await page.keyboard.insertText("Odd: café ß 日本語 עברית 🙂 a<b & c");
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
}

/** The file name the page asks for. Chromium under a non-UTF-8 locale saves any non-ASCII name as "download", so read the link itself. */
async function recordFileNames(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __names: string[] };
    w.__names = [];
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement) { if (this.download) w.__names.push(this.download); return click.call(this); };
  });
}

async function downloadWord(page: Page) {
  await page.getByRole("button", { name: "Download" }).click();
  const [download] = await Promise.all([page.waitForEvent("download"), page.locator("dialog[open]").getByRole("button", { name: /Word/ }).click()]);
  const zip = await JSZip.loadAsync(await readFile((await download.path())!));
  const name = await page.evaluate(() => (window as unknown as { __names: string[] }).__names.at(-1));
  return { name, body: await zip.file("word/document.xml")!.async("string") };
}

test.describe("phone, 375 px, dark mode", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 740 });
    await page.emulateMedia({ colorScheme: "dark" });
  });

  test("the Download button and dialog: 44 px targets, no sideways scroll, no axe violations", async ({ page }, info) => {
    await newNote(page, "History");
    const button = page.getByRole("button", { name: "Download" });
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
    // Icon only on phones.
    await expect(button.getByText("Download")).toBeHidden();
    await button.click();
    const dialog = page.locator("dialog[open]");
    await expect(dialog.getByRole("heading", { name: "Download this note" })).toBeVisible();
    await expect(dialog).toContainText("Get a copy of “Untitled note” to print, share or keep.");
    const buttons = dialog.getByRole("button");
    for (const b of await buttons.all()) {
      const r = (await b.boundingBox())!;
      if (info.project.name === "mobile") expect(r.height, await b.innerText()).toBeGreaterThanOrEqual(44);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.width).toBeLessThanOrEqual(375);
    }
    // PDF and Word stack full width on a phone.
    const [pdf, word] = [(await dialog.getByRole("button", { name: /PDF/ }).boundingBox())!, (await dialog.getByRole("button", { name: /Word/ }).boundingBox())!];
    expect(word.y).toBeGreaterThan(pdf.y);
    expect(Math.abs(word.width - pdf.width)).toBeLessThan(2);
    await expectNoHorizontalScroll(page);
    await expectNoA11yViolations(page);
  });

  test("print (PDF) in dark mode: black on white, only the title and the note; an empty note prints no placeholder", async ({ page }) => {
    await newNote(page, "Geography");
    await page.emulateMedia({ media: "print", colorScheme: "dark" });
    // Empty, untitled note: the title falls back, and the "Start typing" placeholder doesn't print.
    await expect(page.locator(".print-note h1")).toHaveText("Untitled note");
    const placeholder = await page.locator(".tiptap p.is-editor-empty").first().evaluate((el) => getComputedStyle(el, "::before").content);
    expect(placeholder).toBe("none");

    await page.emulateMedia({ media: "screen", colorScheme: "dark" });
    await page.getByLabel("Title").fill("Rivers");
    await editor(page).click();
    await tool(page, "Heading").click();
    await page.keyboard.insertText("Erosion");
    await page.keyboard.press("Enter");
    await tool(page, "Quote").click();
    await page.keyboard.insertText("Rivers shape valleys.");
    await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
    await page.emulateMedia({ media: "print", colorScheme: "dark" });
    await expect(page.locator(".print-note h1")).toHaveText("Rivers");
    const colours = await page.evaluate(() => {
      const c = (sel: string) => getComputedStyle(document.querySelector(sel)!);
      return {
        body: c("body").backgroundColor,
        h1: c(".print-note h1").color,
        h2: c(".print-note .tiptap h2").color,
        quote: c(".print-note .tiptap blockquote").color,
        sheet: c(".print-note .paper-sheet").backgroundImage,
      };
    });
    expect(colours).toEqual({ body: "rgb(255, 255, 255)", h1: "rgb(0, 0, 0)", h2: "rgb(0, 0, 0)", quote: "rgb(0, 0, 0)", sheet: "none" });
    for (const hidden of [page.getByRole("navigation", { name: "Main" }), page.getByRole("toolbar", { name: "Formatting" }), page.getByLabel("Title"), page.getByRole("button", { name: "Download" }), page.getByRole("button", { name: "Delete note" }), page.getByTestId("save-state")]) {
      await expect(hidden).toBeHidden();
    }
    // The note starts at the top of the first page (nothing hidden pushes it down).
    expect((await page.locator(".print-note").boundingBox())!.y).toBeLessThan(5);
  });
});

test("keyboard only: open Download, make the Word file, Esc closes and focus returns to the button", async ({ page }) => {
  await newNote(page, "Physics");
  await page.getByLabel("Title").fill("Forces");
  await editor(page).click();
  await page.keyboard.insertText("Newton's second law: F = ma.");
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
  const button = page.getByRole("button", { name: "Download" });
  await button.focus();
  await page.keyboard.press("Enter");
  const dialog = page.locator("dialog[open]");
  await expect(dialog.getByRole("heading", { name: "Download this note" })).toBeVisible();
  const word = dialog.getByRole("button", { name: /Word/ });
  for (let i = 0; i < 6 && !(await word.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
    expect(await page.evaluate(() => !!document.activeElement?.closest("dialog[open]"))).toBe(true);
  }
  await expect(word).toBeFocused();
  const [download] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("Enter")]);
  expect(download.suggestedFilename()).toBe("Forces.docx");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.getByRole("heading", { name: "Download this note" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(button).toBeFocused();
});

test("toolbar headings, lists and bold survive a reload, and the Word file keeps them", async ({ page }) => {
  await recordFileNames(page);
  await newNote(page, "Politics");
  const title = "Causes of the First World War: alliances, militarism & <imperialism> — “quoted” 😀 / part 1 of a very long series of lecture notes";
  await page.getByLabel("Title").fill(title);
  await writeStructuredNote(page);
  await page.reload();
  const ed = editor(page);
  await expect(ed.locator("h2")).toHaveText("Long-term causes");
  await expect(ed.locator("ol > li > ol > li")).toHaveText(["Triple Entente", "Triple Alliance"]);
  await expect(ed.locator("ul > li > ul > li")).toHaveText("Dreadnoughts");
  await expect(ed.locator("strong")).toHaveText("Odd: café ß 日本語 עברית 🙂 a<b & c");
  await expect(page.getByText("Something went wrong")).toHaveCount(0);

  const { name, body } = await downloadWord(page);
  expect(name).toBe("Causes of the First World War - alliances, militarism & - imperialism - — “quoted” 😀 - part 1 of a v.docx");
  expect(body).toContain("Causes of the First World War: alliances, militarism &amp; &lt;imperialism&gt; — “quoted” 😀");
  expect(body).toMatch(/<w:pStyle w:val="Heading2"\/>[\s\S]*?Long-term causes/);
  expect(body).toMatch(/<w:ilvl w:val="1"\/>[\s\S]*?Triple Entente/);
  expect(body).toMatch(/<w:ilvl w:val="0"\/>[\s\S]*?Militarism/);
  expect(body).toMatch(/<w:ilvl w:val="1"\/>[\s\S]*?Dreadnoughts/);
  expect(body).toMatch(/<w:b\/>[\s\S]*?Odd: café ß 日本語 עברית 🙂 a&lt;b &amp; c/);
});

test("an empty, untitled note downloads as a Word file named Untitled note", async ({ page }) => {
  await recordFileNames(page);
  await newNote(page, "Art");
  const { name, body } = await downloadWord(page);
  expect(name).toBe("Untitled note.docx");
  expect(body).toContain('<w:pStyle w:val="Title"/>');
  expect(body).toContain("Untitled note");
});

test("mindmap: the notes-changed banner has no button of its own; the header's ↻ makes the new map", async ({ page }, info) => {
  await newNote(page, "Ecology");
  await page.getByLabel("Title").fill("Food webs");
  await editor(page).click();
  await page.keyboard.insertText([
    "Producers such as grass and algae make their own food from sunlight by photosynthesis.",
    "Primary consumers like rabbits and zooplankton eat the producers.",
    "Secondary consumers such as foxes eat the primary consumers.",
    "Decomposers like fungi and bacteria break down dead matter and return nutrients to the soil.",
    "Energy is lost as heat at every trophic level, so food chains are rarely longer than five links.",
  ].join(" "));
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
  const noteUrl = page.url();
  await page.goto(noteUrl.replace(/\/notes\/.*$/, ""));
  await page.getByRole("link", { name: /^Mindmap/ }).click();
  await page.getByRole("button", { name: "Make a mindmap" }).click();
  await expect(page.locator(".mm-detail").first()).toBeVisible({ timeout: 20_000 });
  const mapUrl = page.url();
  await expect(page.getByText("Your notes changed since this map was made.")).toHaveCount(0);

  await page.goto(noteUrl);
  await editor(page).click();
  await page.keyboard.press("End");
  await page.keyboard.insertText(" Apex predators sit at the top.");
  await expect(page.getByTestId("save-state")).toHaveText("Saved ✓", { timeout: 10_000 });
  await page.goto(mapUrl);
  const banner = page.getByRole("status").filter({ hasText: "Your notes changed since this map was made." });
  await expect(banner).toHaveText("Your notes changed since this map was made. Tap ↻ above to update it.");
  await expect(banner.getByRole("button")).toHaveCount(0);
  const regenerate = page.getByRole("button", { name: info.project.name === "mobile" ? "New map" : "Regenerate", exact: true });
  await expect(regenerate).toBeVisible();
  await expect(page.getByRole("button", { name: /Regenerate|New map/ }).filter({ visible: true })).toHaveCount(1);
  await expectNoHorizontalScroll(page);
  await regenerate.click();
  await expect(page.locator("dialog[open]").getByRole("button", { name: "Make new map" })).toBeVisible();
});

for (const width of [640, 900, 1920]) {
  test(`read aloud at ${width} px: the voice picker keeps its width beside the online-voice hint`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop", "Wide screens only");
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() => {
      const voices = [
        { name: "Microsoft Ava Online (Natural) - English (United States)", lang: "en-US", voiceURI: "ava", localService: false, default: true },
        { name: "Google UK English Female", lang: "en-GB", voiceURI: "uk", localService: true, default: false },
      ];
      const synth = { speaking: false, paused: false, pending: false, getVoices: () => voices, speak: () => {}, cancel: () => {}, pause: () => {}, resume: () => {}, addEventListener: () => {}, removeEventListener: () => {} };
      Object.defineProperty(window, "speechSynthesis", { value: synth, configurable: true });
      Object.defineProperty(window, "SpeechSynthesisUtterance", { value: class { constructor(public text: string) {} }, configurable: true });
    });
    await newNote(page, "Music");
    await editor(page).click();
    await page.keyboard.insertText("Sonata form has an exposition, a development and a recapitulation.");
    await page.getByRole("button", { name: "Read aloud" }).click();
    const bar = page.getByRole("region", { name: "Read aloud" });
    const [voice, hint, speed] = [bar.getByLabel("Voice"), bar.getByText("Online voices send the text"), bar.getByLabel("Speed")];
    await expect(hint).toBeVisible();
    const [v, h, s] = [(await voice.boundingBox())!, (await hint.boundingBox())!, (await speed.boundingBox())!];
    expect(v.width).toBeGreaterThan(150);
    const overlap = (a: typeof v, b: typeof v) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
    expect(overlap(v, h)).toBe(false);
    expect(overlap(v, s)).toBe(false);
    await expectNoHorizontalScroll(page);
  });
}
