// QA (docs/qa/flashcard-pages-50.md): card quality on realistic lecture text.
// Bradley: quantity and quality matter equally, and what a card says must be accurate.
// Each case is a card a model could plausibly write, labelled by a human as GOOD (accurate,
// grounded in the passage, worth studying) or BAD (wrong number, invented term, outside
// knowledge, non-answer). The test locks the current behaviour of the filter and reports the
// false-drop rate (good cards thrown away) and false-keep rate (bad cards that get through).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { extractFile } from "../extract";
import { normaliseFlashcardsWithStats } from "./schemas";
import { toPassages } from "./tasks";
import type { Passage } from "./types";

const mk = (n: number, text: string, page: number | null = null): Passage => ({
  ref: `p${n}`, chunkId: `00000000-0000-4000-8000-00000000000${n}`, text, page,
} as Passage);

const BIO = mk(1, "Human body temperature is normally maintained at about 37 °C by the hypothalamus. The normal pH of arterial blood is 7.35–7.45; values below 7.35 indicate acidosis. Mitochondria produce ATP through oxidative phosphorylation, yielding about 30–32 ATP per glucose molecule. The resting membrane potential of a typical neuron is −70 mV, maintained by the sodium–potassium pump.", 3);
const CHEM = mk(2, "Sulfuric acid (H₂SO₄) is a strong diprotic acid. Its molar mass is 98.08 g/mol. Concentrated sulfuric acid is about 98% H₂SO₄ by mass and has a density of 1.84 g/cm³. Diluting it releases a lot of heat, so the acid is always added to water, never water to acid. Avogadro's number is 6.022 × 10²³ per mole.", 7);
const HIST = mk(3, "The Treaty of Versailles was signed on 28 June 1919, five years to the day after the assassination of Archduke Franz Ferdinand. Germany was required to pay reparations of 132 billion gold marks, set by the London Schedule of Payments in 1921. The treaty reduced the German army to 100,000 men and banned conscription.", 12);
const DE = mk(4, "Die Erdbeschleunigung beträgt auf Meereshöhe etwa 9,81 m/s². Wasser siedet auf Meereshöhe bei 100 °C. Der Luftdruck nimmt mit der Höhe ab.", 15);
const SPACE = mk(5, "The average surface temperature of Mars is about −63 °C, and it can drop to −140 °C at the poles in winter. Mars has two small moons, Phobos and Deimos.", 18);
const ECON = mk(6, "In the UK, consumer price inflation fell from 10.1% in March 2023 to 4.0% in December 2023. The Bank of England raised the base rate 14 times between December 2021 and August 2023, to 5.25%.", 22);
const PASSAGES = [BIO, CHEM, HIST, DE, SPACE, ECON];

type Case = { p: Passage; front: string; back: string; good: boolean; note?: string };

const CASES: Case[] = [
  // ---- GOOD: accurate, grounded (should be kept) ----
  { p: BIO, front: "At what temperature is the human body normally kept?", back: "About 37 °C.", good: true },
  { p: BIO, front: "Which part of the brain keeps body temperature at about 37 °C?", back: "The hypothalamus.", good: true },
  { p: BIO, front: "What is the normal pH range of arterial blood?", back: "7.35–7.45", good: true, note: "range with en dash" },
  { p: BIO, front: "What is the normal pH range of arterial blood (written with 'to')?", back: "From 7.35 to 7.45.", good: true },
  { p: BIO, front: "What does an arterial blood pH below 7.35 indicate?", back: "Acidosis.", good: true },
  { p: BIO, front: "How many ATP does oxidative phosphorylation yield per glucose?", back: "About 30–32 ATP per glucose molecule.", good: true },
  { p: BIO, front: "What is the resting membrane potential of a typical neuron?", back: "−70 mV", good: true, note: "negative, Unicode minus" },
  { p: BIO, front: "What is the resting potential of a neuron, in millivolts?", back: "-70 mV", good: true, note: "negative, ASCII hyphen" },
  { p: BIO, front: "How do mitochondria make ATP?", back: "By oxidative phosphorylation.", good: true },
  { p: BIO, front: "What keeps the neuron's resting potential at −70 mV?", back: "The sodium–potassium pump.", good: true },
  { p: BIO, front: "Which organelle carries out oxidative phosphorylation?", back: "Mitochondrion", good: true, note: "singular of 'mitochondria'" },
  { p: BIO, front: "What does the hypothalamus do with body temperature?", back: "It regulates body heat, holding it near 37 °C.", good: true, note: "synonyms regulates/heat" },
  { p: CHEM, front: "What is the chemical formula of sulfuric acid?", back: "H₂SO₄", good: true, note: "subscript digits" },
  { p: CHEM, front: "Write the formula of sulfuric acid in plain text.", back: "H2SO4", good: true, note: "ASCII digits vs subscripts in passage" },
  { p: CHEM, front: "What is the molar mass of sulfuric acid?", back: "98.08 g/mol", good: true },
  { p: CHEM, front: "What is the density of concentrated sulfuric acid?", back: "1.84 g/cm³", good: true },
  { p: CHEM, front: "Is sulfuric acid monoprotic or diprotic?", back: "Diprotic, and it is a strong acid.", good: true },
  { p: CHEM, front: "Why is acid always added to water, not water to acid?", back: "Because diluting it releases a lot of heat.", good: true },
  { p: CHEM, front: "What is Avogadro's number?", back: "6.022 × 10²³ per mole", good: true },
  { p: CHEM, front: "What is Avogadro's number (caret notation)?", back: "6.022 × 10^23 per mole", good: true, note: "^23 vs superscript in passage" },
  { p: CHEM, front: "List the three numbers given for concentrated sulfuric acid.", back: "About 98% H₂SO₄ by mass, density 1.84 g/cm³, molar mass 98.08 g/mol.", good: true, note: "list" },
  { p: HIST, front: "When was the Treaty of Versailles signed?", back: "28 June 1919", good: true },
  { p: HIST, front: "How much did Germany have to pay in reparations?", back: "132 billion gold marks.", good: true },
  { p: HIST, front: "How large could the German army be after the treaty?", back: "100,000 men.", good: true },
  { p: HIST, front: "How large could the German army be (SI spacing)?", back: "100 000 men.", good: true, note: "thin-space thousands" },
  { p: HIST, front: "How long after Franz Ferdinand's assassination was the treaty signed?", back: "Exactly five years to the day.", good: true },
  { p: HIST, front: "How many years after the assassination was the treaty signed?", back: "5 years, to the day.", good: true, note: "digit for a number word" },
  { p: HIST, front: "What did the treaty ban in Germany?", back: "Conscription.", good: true },
  { p: DE, front: "Wie groß ist die Erdbeschleunigung auf Meereshöhe?", back: "Etwa 9,81 m/s².", good: true, note: "decimal comma" },
  { p: DE, front: "Wie groß ist die Erdbeschleunigung (mit Punkt geschrieben)?", back: "9.81 m/s²", good: true, note: "dot vs comma" },
  { p: DE, front: "Bei welcher Temperatur siedet Wasser auf Meereshöhe?", back: "Bei 100 °C.", good: true },
  { p: SPACE, front: "What is the average surface temperature of Mars?", back: "About −63 °C.", good: true },
  { p: SPACE, front: "How cold can the Martian poles get in winter?", back: "Down to −140 °C.", good: true, note: "one filler word + number" },
  { p: SPACE, front: "What are the names of Mars's two moons?", back: "Phobos and Deimos.", good: true },
  { p: ECON, front: "What was UK inflation in December 2023?", back: "4.0%", good: true },
  { p: ECON, front: "What was UK inflation at the end of 2023, rounded?", back: "4%", good: true, note: "4% vs 4.0%" },
  { p: ECON, front: "How many times did the Bank of England raise the base rate?", back: "14 times, up to 5.25%.", good: true },
  // A number worked out from the passage can't be checked against it: dropped by design (accuracy first).
  { p: ECON, front: "By how many percentage points did inflation fall in 2023?", back: "6.1 percentage points (10.1% to 4.0%).", good: false, note: "derived number, unverifiable" },

  // ---- BAD: should be dropped ----
  { p: BIO, front: "What is normal human body temperature?", back: "About 38 °C.", good: false, note: "wrong number" },
  { p: BIO, front: "What is the lower limit of normal arterial pH?", back: "7.45", good: false, note: "swapped number that appears in the passage" },
  { p: BIO, front: "What is the resting membrane potential of a neuron?", back: "+70 mV", good: false, note: "sign flip" },
  { p: BIO, front: "Which pathways do mitochondria use to make ATP?", back: "The Krebs cycle and the electron transport chain.", good: false, note: "outside knowledge" },
  { p: BIO, front: "Where exactly does oxidative phosphorylation happen?", back: "On the cristae of the inner mitochondrial membrane, by oxidative phosphorylation.", good: false, note: "invented term (cristae) mixed with grounded words" },
  { p: BIO, front: "What hormone lowers blood glucose?", back: "Insulin, released by beta cells of the pancreas.", good: false, note: "outside knowledge" },
  { p: CHEM, front: "What is the density of concentrated sulfuric acid?", back: "1.83 g/cm³", good: false, note: "wrong decimal" },
  { p: CHEM, front: "What is the pKa of sulfuric acid's first dissociation?", back: "About −3.", good: false, note: "outside knowledge number" },
  { p: CHEM, front: "What is the molar mass of sulfuric acid?", back: "The molar mass of sulfuric acid.", good: false, note: "non-answer" },
  { p: HIST, front: "When was the Treaty of Versailles signed?", back: "28 June 1918", good: false, note: "wrong year" },
  { p: HIST, front: "How much did Germany have to pay in reparations?", back: "132 million gold marks.", good: false, note: "wrong scale word" },
  { p: HIST, front: "Who signed the treaty for Germany?", back: "Hermann Müller and Johannes Bell.", good: false, note: "outside knowledge names" },
  { p: HIST, front: "Why did the US Senate reject the treaty?", back: "Opposition to the League of Nations, led by Henry Cabot Lodge.", good: false, note: "outside knowledge" },
  { p: SPACE, front: "Why is Mars so cold?", back: "Its thin carbon dioxide atmosphere holds little heat.", good: false, note: "outside knowledge" },
  { p: SPACE, front: "Which moon of Mars is larger?", back: "Phobos is the larger of the two moons.", good: false, note: "unsupported claim with grounded words" },
  { p: ECON, front: "What was UK inflation in December 2023?", back: "5.25%", good: false, note: "wrong number from the same passage" },
  { p: ECON, front: "What is the Bank of England's inflation target?", back: "2%", good: false, note: "outside knowledge number" },
  { p: CHEM, front: "Sulfuric acid", back: "Strong diprotic acid", good: false, note: "not a question" },
];

function kept(c: Case): boolean {
  const out = normaliseFlashcardsWithStats({ cards: [{ front: c.front, back: c.back, passage: c.p.ref, quote: "" }] }, PASSAGES, 25);
  return !!out && out.cards.length === 1;
}

const results = CASES.map((c) => ({ ...c, kept: kept(c) }));
const falseDrops = results.filter((r) => r.good && !r.kept);
const falseKeeps = results.filter((r) => !r.good && r.kept);
const goodN = results.filter((r) => r.good).length;
const badN = results.length - goodN;

describe("card quality filter on realistic lecture text (QA sample)", () => {
  it("reports false-drop and false-keep rates", () => {
    const pct = (a: number, b: number) => `${((100 * a) / b).toFixed(0)}%`;
    console.log(`[card-quality] good kept ${goodN - falseDrops.length}/${goodN}, false drops ${falseDrops.length} (${pct(falseDrops.length, goodN)})`);
    for (const r of falseDrops) console.log(`  FALSE DROP: ${r.back}  [${r.note ?? ""}]`);
    console.log(`[card-quality] bad dropped ${badN - falseKeeps.length}/${badN}, false keeps ${falseKeeps.length} (${pct(falseKeeps.length, badN)})`);
    for (const r of falseKeeps) console.log(`  FALSE KEEP: ${r.back}  [${r.note ?? ""}]`);
    expect(goodN).toBeGreaterThanOrEqual(30);
  });

  // Locks the current numbers so a change to the filter shows up here. Lower is better for both;
  // update the snapshot (and docs/qa/flashcard-pages-50.md) when the filter improves.
  it("current false drops and false keeps (known, see QA report)", () => {
    expect(falseDrops.map((r) => r.back)).toEqual(["It regulates body heat, holding it near 37 °C."]);
    expect(falseKeeps.map((r) => r.back)).toEqual([
      "7.45",
      "On the cristae of the inner mitochondrial membrane, by oxidative phosphorylation.",
      "Phobos is the larger of the two moons.",
      "5.25%",
    ]);
  });

  it("every clearly wrong number or outside-knowledge answer that has no overlap is dropped", () => {
    for (const back of ["About 38 °C.", "1.83 g/cm³", "28 June 1918", "Hermann Müller and Johannes Bell.", "Insulin, released by beta cells of the pancreas.", "The Krebs cycle and the electron transport chain.", "2%"]) {
      expect(results.find((r) => r.back === back)?.kept, back).toBe(false);
    }
  });
});

// ---- Science notation, through the whole path: PDF → extraction → passages → filter ----------
// e2e/fixtures/science-lecture.pdf (make-science-lecture.py): page 1 names and formulas, page 2
// equations, Greek letters and units, page 3 Word-style sub/superscripts.

type Sci = { page: 1 | 2 | 3; front: string; back: string; good: boolean; note?: string };
const SCIENCE: Sci[] = [
  { page: 1, front: "Which bacterium lives in the human gut?", back: "Escherichia coli (E. coli).", good: true },
  { page: 1, front: "Which species does E. coli live in?", back: "Homo sapiens.", good: true },
  { page: 1, front: "What is the overall equation for photosynthesis?", back: "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂", good: true },
  { page: 1, front: "Write the photosynthesis equation in plain text.", back: "6CO2 + 6H2O -> C6H12O6 + 6O2", good: true, note: "ASCII digits and ->" },
  { page: 1, front: "What is the molecular formula of glucose?", back: "C6H12O6", good: true },
  { page: 1, front: "What is the molar mass of glucose?", back: "180.16 g/mol", good: true },
  { page: 1, front: "What charge does the sulfate ion carry?", back: "SO₄²⁻ carries a charge of −2.", good: true },
  { page: 1, front: "What charge does the sulfate ion carry (plain text)?", back: "SO4^2- has a charge of -2.", good: true, note: "caret superscript" },
  { page: 1, front: "Which ion carries a charge of +2?", back: "The calcium ion, Ca2+.", good: true, note: "flattened superscript" },
  { page: 1, front: "How does carbonic acid dissociate?", back: "Reversibly: H₂CO₃ ⇌ H⁺ + HCO₃⁻", good: true },
  { page: 1, front: "How does carbonic acid dissociate (plain text)?", back: "H2CO3 <=> H+ + HCO3-", good: true, note: "ASCII <=>" },
  { page: 1, front: "Which tumour suppressor gene is linked to breast cancer?", back: "BRCA1", good: true },
  { page: 1, front: "Which protein halts the cell cycle when DNA is damaged?", back: "p53", good: true },
  { page: 1, front: "What does the Na⁺/K⁺-ATPase do for each ATP hydrolysed?", back: "It pumps 3 Na⁺ out of the cell and 2 K⁺ in.", good: true },
  { page: 1, front: "What does the sodium pump do (plain text)?", back: "The Na+/K+-ATPase pumps 3 Na+ out and 2 K+ in per ATP.", good: true },
  { page: 1, front: "What is the bond angle of a water molecule?", back: "About 104.5°.", good: true },
  { page: 2, front: "What equation gives the Gibbs free energy change?", back: "ΔG = ΔH − TΔS", good: true },
  { page: 2, front: "Write the Gibbs equation with a hyphen for minus.", back: "ΔG = ΔH - TΔS", good: true, note: "hyphen vs minus" },
  { page: 2, front: "When is a reaction spontaneous?", back: "When ΔG is negative.", good: true },
  { page: 2, front: "What is Einstein's mass–energy equivalence?", back: "E = mc²", good: true },
  { page: 2, front: "Write Einstein's equation with a caret.", back: "E = mc^2", good: true },
  { page: 2, front: "Write Einstein's equation flat.", back: "E=mc2", good: true, note: "flattened superscript" },
  { page: 2, front: "How is pH defined?", back: "pH = −log[H⁺]", good: true },
  { page: 2, front: "How is pH defined (plain text)?", back: "pH = -log[H+]", good: true },
  { page: 2, front: "What is the normal pH range of arterial blood?", back: "7.35–7.45", good: true },
  { page: 2, front: "How many residues per turn does an α-helix have?", back: "3.6 residues per turn.", good: true },
  { page: 2, front: "What holds β-sheets together?", back: "Hydrogen bonds between strands.", good: true },
  { page: 2, front: "How big is a typical animal cell?", back: "10–30 µm across.", good: true, note: "micro sign; PDF gave Greek mu" },
  { page: 2, front: "What is the resting membrane potential?", back: "−70 mV", good: true },
  { page: 2, front: "What is the usual blood glucose concentration?", back: "About 5.5 mmol·L⁻¹", good: true },
  { page: 2, front: "What is the usual blood glucose concentration (plain text)?", back: "About 5.5 mmol L-1", good: true, note: "ASCII exponent" },
  { page: 2, front: "How did the rate constant change with a 10 °C rise?", back: "It doubled from 0.012 s⁻¹ to 0.024 s⁻¹.", good: true },
  { page: 3, front: "What is the overall equation for respiration?", back: "C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O", good: true, note: "Word-style subscripts in the PDF" },
  { page: 3, front: "What is the speed of light?", back: "3.0 × 10⁸ m/s", good: true, note: "Word-style superscript in the PDF" },
  { page: 3, front: "What is the speed of light (caret)?", back: "3.0 × 10^8 m/s", good: true },
  { page: 3, front: "Which ions trigger muscle contraction?", back: "Calcium ions (Ca²⁺).", good: true },
  { page: 3, front: "What is the lowest temperature on the Kelvin scale, in °C?", back: "−273.15 °C", good: true },
  { page: 3, front: "Why is mitochondrial efficiency limited?", back: "Some energy is lost as heat during oxidative phosphorylation.", good: true, note: "fi ligature in the PDF" },

  { page: 1, front: "What is the molecular formula of glucose?", back: "C₆H₁₂O₅", good: false, note: "wrong subscript" },
  { page: 1, front: "What is the overall equation for photosynthesis?", back: "6CO₂ + 6H₂O → C₆H₁₂O₆ + 5O₂", good: false, note: "wrong coefficient" },
  { page: 1, front: "What is the overall equation for photosynthesis?", back: "6CO₂ + 12H₂O → C₆H₁₂O₆ + 6O₂", good: false, note: "wrong coefficient" },
  { page: 1, front: "How does carbonic acid dissociate?", back: "H₂CO₃ → H⁺ + HCO₃⁻", good: false, note: "⇌ changed to → (no longer reversible)" },
  { page: 1, front: "Which tumour suppressor gene is linked to breast cancer?", back: "BRCA2", good: false, note: "wrong gene" },
  { page: 1, front: "Which protein halts the cell cycle when DNA is damaged?", back: "p63", good: false, note: "wrong protein" },
  { page: 1, front: "Which species does E. coli live in?", back: "Homo erectus.", good: false, note: "wrong species" },
  { page: 1, front: "Which bacterium lives in the human gut?", back: "E. faecalis.", good: false, note: "wrong species" },
  { page: 1, front: "What charge does the calcium ion carry?", back: "Ca³⁺, a charge of +3.", good: false, note: "wrong charge" },
  { page: 2, front: "What equation gives the Gibbs free energy change?", back: "ΔG = ΔH + TΔS", good: false, note: "sign swapped" },
  { page: 2, front: "What is Einstein's mass–energy equivalence?", back: "E = mc³", good: false, note: "wrong exponent" },
  { page: 2, front: "How is pH defined?", back: "pH = log[H⁺]", good: false, note: "minus dropped" },
  { page: 2, front: "How many residues per turn does a β-helix have?", back: "A β-helix has 3.6 residues per turn.", good: false, note: "α changed to β" },
  { page: 2, front: "What is the resting membrane potential?", back: "+70 mV", good: false, note: "sign flip" },
  { page: 2, front: "How big is a typical animal cell?", back: "10–30 mm across.", good: false, note: "wrong unit prefix" },
  { page: 3, front: "What is the speed of light?", back: "3.0 × 108 m/s", good: false, note: "flattened superscript is a wrong number" },
  { page: 1, front: "What charge does the sulfate ion carry?", back: "SO₄²⁻ carries a charge of −1.", good: false, note: "wrong charge" },
];

describe("science notation: PDF extraction → passages → grounding filter (QA sample)", () => {
  it("keeps faithful cards and drops changed terms, equations and numbers", async () => {
    const r = await extractFile(new Uint8Array(readFileSync(new URL("../../../e2e/fixtures/science-lecture.pdf", import.meta.url))), "science.pdf");
    if (r.status !== "ready") throw new Error(r.status);
    const passages = toPassages(r.chunks.map((c, i) => ({ id: `00000000-0000-4000-8000-0000000000${String(i).padStart(2, "0")}`, text: c.text, page: c.page })));
    const onPage = (n: number) => passages.find((p) => p.page === n)!;
    const out = SCIENCE.map((c) => {
      const res = normaliseFlashcardsWithStats({ cards: [{ front: c.front, back: c.back, passage: onPage(c.page).ref, quote: "" }] }, passages, 25);
      return { ...c, kept: !!res && res.cards.length === 1 && res.cards[0].back === c.back };
    });
    const drops = out.filter((x) => x.good && !x.kept);
    const keeps = out.filter((x) => !x.good && x.kept);
    const good = out.filter((x) => x.good).length;
    console.log(`[science] good kept ${good - drops.length}/${good}; bad dropped ${out.length - good - keeps.length}/${out.length - good}`);
    for (const x of drops) console.log(`  FALSE DROP: ${x.back}  [${x.note ?? ""}]`);
    for (const x of keeps) console.log(`  FALSE KEEP: ${x.back}  [${x.note ?? ""}]`);
    expect(drops.map((x) => x.back)).toEqual([]);
    expect(keeps.map((x) => x.back)).toEqual([]);
  });
});
