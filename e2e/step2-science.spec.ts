import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createSubject, expectNoA11yViolations, expectNoHorizontalScroll, rowAction, startDemo } from "./helpers";

// Bradley (2026-10-17): biology terms, formulas and equations must be captured accurately.
// science-lecture.pdf (e2e/fixtures/make-science-lecture.py): binomial names, gene names,
// formulas with sub/superscripts, equations, Greek letters, arrows and units; page 3 is
// Word-style (small raised/lowered digits, an "fi" ligature).

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

const FILE = "science-lecture.pdf";

test("science notation survives extraction, cards, display and read-aloud", async ({ page }) => {
  await stubSpeech(page);
  await startDemo(page);
  await createSubject(page, "Biochemistry");
  await page.getByRole("link", { name: /Biochemistry/ }).click();
  await page.locator("#file-input").setInputFiles(path.join(__dirname, "fixtures", FILE));
  await expect(page.getByText("Ready · 3 pages")).toBeVisible({ timeout: 20_000 });

  // Cards from the file: whatever the generator picks, notation is kept character for character.
  await rowAction(page, FILE, "Make flashcards", `Make flashcards from ${FILE}`);
  const dialog = page.locator("dialog[open]");
  await dialog.getByRole("button", { name: "Make flashcards" }).click();
  await expect(dialog.getByRole("heading", { name: /new cards?!/ })).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Done" }).click();
  await page.getByRole("link", { name: /^Flashcards/ }).click();
  const list = page.getByRole("list", { name: "Cards" });
  await expect(list.getByRole("article").first()).toBeVisible();
  const deckText = (await list.innerText()).replace(/\s+/g, " ");
  expect(deckText).toMatch(/C₆H₁₂O₆|H₂O|SO₄²⁻|Ca²⁺|ΔG|10⁸|α-helix|−70 mV/);
  // Nothing flattened or cut: no 10⁸ read as 108, no number cut at its decimal point.
  expect(deckText).not.toContain("108 m/s");
  expect(deckText).not.toMatch(/blood is 7\b(?!\.)/);

  // The read-only source page shows the extracted text faithfully, page 3 (Word-style) included.
  await list.getByRole("article").first().getByRole("link", { name: FILE }).click();
  await expect(page).toHaveURL(/\/sources\//);
  const main = page.locator("main");
  for (const s of ["6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂", "H₂CO₃ ⇌ H⁺ + HCO₃⁻", "Na⁺/K⁺-ATPase", "ΔG = ΔH − TΔS", "E = mc²", "pH = −log[H⁺]", "5.5 mmol·L⁻¹", "3.0 × 10⁸ m/s", "efficiency", "−273.15 °C"]) {
    await expect(main, s).toContainText(s);
  }
  await page.goBack();

  // A hand-written card with notation is saved, shown and read aloud sensibly.
  await page.getByRole("button", { name: "Add a card" }).first().click();
  await page.getByLabel("Front").fill("What is the overall equation for photosynthesis in E. coli's host plant?");
  await page.getByLabel("Back").fill("6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂; ΔG > 0 and Ca²⁺ is 10⁻³ mol·L⁻¹");
  await page.getByRole("button", { name: "Save card" }).click();
  const card = list.getByRole("article").filter({ hasText: "overall equation for photosynthesis" });
  await expect(card).toContainText("6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂; ΔG > 0 and Ca²⁺ is 10⁻³ mol·L⁻¹");
  await page.reload();
  await expect(card).toContainText("6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂; ΔG > 0 and Ca²⁺ is 10⁻³ mol·L⁻¹");

  // Glyphs Atkinson Hyperlegible lacks fall back to a science-capable font, not to tofu.
  const family = await card.evaluate((el) => getComputedStyle(el).fontFamily);
  expect(family).toMatch(/Atkinson/);
  expect(family).toMatch(/Cambria Math|STIX Two Math|Noto Sans Math|DejaVu Sans/);

  await card.getByRole("button", { name: /^Read aloud: card/ }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length)).toBeGreaterThan(0);
  await page.evaluate(() => (window as unknown as { __finishSentence: () => void }).__finishSentence());
  await expect.poll(() => page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.length)).toBeGreaterThan(1);
  const spoken = await page.evaluate(() => (window as unknown as { __spoken: string[] }).__spoken.join(" | "));
  expect(spoken).toContain("6CO 2 + 6H 2 O gives C 6 H 12 O 6 + 6O 2");
  expect(spoken).toContain("delta G");
  expect(spoken).toContain("Ca 2 plus");
  expect(spoken).toContain("10 to the power minus 3");
  expect(spoken).not.toMatch(/[₀-₉⁰¹²³⁴-⁹⁺⁻⇌→Δ]/);

  await expectNoA11yViolations(page);
  await expectNoHorizontalScroll(page);
});
