// QA (docs/qa/step-3.md): quiz and chat accuracy on realistic science lecture text.
// Bradley: quantity and quality matter equally, and what a question or answer says must be
// accurate. Each case is something a model could plausibly write, labelled by a human as GOOD
// (accurate, grounded in the passage it cites) or BAD (wrong answer key, invented term, outside
// knowledge, wrong number or formula, two right options, uncited, a passage that wasn't sent).
// The test locks the filter's behaviour and reports false drops (good items thrown away) and
// false keeps (bad items that get through). Update the expected numbers and the sign-off when the
// filter improves.
import { describe, expect, it } from "vitest";
import { normaliseChatReply } from "../chat/answer";
import { contradictsPassage, swapIn } from "./contradict";
import { normaliseQuizWithStats } from "./quiz";
import type { Passage } from "./types";

const mk = (n: number, text: string, page: number | null = null): Passage => ({
  ref: `p${n}`, chunkId: `00000000-0000-4000-8000-00000000000${n}`, text, page,
});

const CELL = mk(1, "Osmosis is the net movement of water molecules across a partially permeable membrane from a region of lower solute concentration to a region of higher solute concentration. A cell placed in a hypotonic solution gains water and may burst; in a hypertonic solution it loses water and shrinks. Mitosis produces two genetically identical diploid daughter cells, whereas meiosis produces four genetically different haploid gametes.", 4);
const NEURO = mk(2, "The resting membrane potential of a typical neuron is −70 mV. During depolarisation, voltage-gated sodium channels open and Na⁺ ions flow into the cell. The action potential peaks at about +40 mV. Afferent neurons carry impulses towards the central nervous system, while efferent neurons carry impulses away from it.", 9);
const CHEM = mk(3, "Glucose has the formula C₆H₁₂O₆. In aerobic respiration, C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O. Enzymes in the human body work best at 37 °C and most denature above 45 °C. Nitrate (NO₃⁻) is taken up by plant roots and used to make amino acids.", 12);
const GENE = mk(4, "DNA contains four bases: adenine, thymine, guanine and cytosine. In RNA, uracil replaces thymine. The enzyme DNA ligase joins Okazaki fragments on the lagging strand, while DNA polymerase III adds nucleotides in the 5′ to 3′ direction. Escherichia coli divides about every 20 minutes in ideal conditions.", 15);
const PASSAGES = [CELL, NEURO, CHEM, GENE];

type Q = Record<string, unknown>;
type QuizCase = { q: Q; good: boolean; note: string };

const mcq = (p: Passage, prompt: string, options: string[], answer: string, explanation: string, topic: string, quote?: string): Q =>
  ({ type: "mcq", prompt, options, answer, passage: p.ref, quote, topic, explanation });
const fill = (p: Passage, prompt: string, answer: string, explanation: string, topic: string, accepted: string[] = [], quote?: string): Q =>
  ({ type: "fill", prompt, answer, accepted, passage: p.ref, quote, topic, explanation });

const QUIZ: QuizCase[] = [
  // ---- GOOD ----
  { good: true, note: "hypotonic, MCQ", q: mcq(CELL, "What happens to a cell placed in a hypotonic solution?", ["It gains water and may burst", "It loses water and shrinks", "It stays exactly the same", "It loses all of its solutes"], "It gains water and may burst", "In a hypotonic solution the cell gains water and may burst.", "Osmosis", "A cell placed in a hypotonic solution gains water and may burst") },
  { good: true, note: "hypertonic, fill", q: fill(CELL, "In a ____ solution, a cell loses water and shrinks.", "hypertonic", "A cell in a hypertonic solution loses water and shrinks.", "Osmosis") },
  { good: true, note: "number word option", q: mcq(CELL, "How many daughter cells does mitosis produce?", ["Two", "Four", "One", "Eight"], "Two", "Mitosis produces two genetically identical diploid daughter cells.", "Cell division") },
  { good: true, note: "meiosis, fill", q: fill(CELL, "Meiosis produces four genetically different haploid ____.", "gametes", "Meiosis produces four genetically different haploid gametes.", "Cell division", ["gamete"]) },
  { good: true, note: "negative value with unit", q: mcq(NEURO, "What is the resting membrane potential of a typical neuron?", ["−70 mV", "+40 mV", "−40 mV", "0 mV"], "−70 mV", "The resting membrane potential of a typical neuron is −70 mV.", "Membrane potential") },
  { good: true, note: "sodium channels, fill", q: fill(NEURO, "During depolarisation, voltage-gated ____ channels open.", "sodium", "During depolarisation voltage-gated sodium channels open and Na⁺ ions flow into the cell.", "Action potential", ["Na+"]) },
  { good: true, note: "afferent, MCQ", q: mcq(NEURO, "Which neurons carry impulses towards the central nervous system?", ["Afferent neurons", "Efferent neurons", "Motor neurons", "Relay neurons"], "Afferent neurons", "Afferent neurons carry impulses towards the central nervous system.", "Neurons") },
  { good: true, note: "positive value with unit, fill", q: fill(NEURO, "The action potential peaks at about ____.", "+40 mV", "The action potential peaks at about +40 mV.", "Action potential", ["40 mV"]) },
  { good: true, note: "formula with subscripts", q: fill(CHEM, "Glucose has the formula ____.", "C₆H₁₂O₆", "Glucose has the formula C₆H₁₂O₆.", "Respiration", ["C6H12O6"]) },
  { good: true, note: "temperature, fill", q: fill(CHEM, "Enzymes in the human body work best at ____.", "37 °C", "Enzymes in the human body work best at 37 °C and most denature above 45 °C.", "Enzymes") },
  { good: true, note: "equation option", q: mcq(CHEM, "What are the products of aerobic respiration?", ["6CO₂ + 6H₂O", "C₆H₁₂O₆ + 6O₂", "6O₂ + 6H₂O", "6CO₂ + 6O₂"], "6CO₂ + 6H₂O", "In aerobic respiration, C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O.", "Respiration") },
  { good: true, note: "ion with charge", q: mcq(CHEM, "Which ion is taken up by plant roots to make amino acids?", ["Nitrate (NO₃⁻)", "Glucose", "Oxygen", "Water"], "Nitrate (NO₃⁻)", "Nitrate (NO₃⁻) is taken up by plant roots and used to make amino acids.", "Plant nutrition") },
  { good: true, note: "uracil, MCQ", q: mcq(GENE, "Which base replaces thymine in RNA?", ["Uracil", "Adenine", "Cytosine", "Guanine"], "Uracil", "In RNA, uracil replaces thymine.", "Nucleic acids") },
  { good: true, note: "ligase, fill", q: fill(GENE, "The enzyme DNA ____ joins Okazaki fragments on the lagging strand.", "ligase", "The enzyme DNA ligase joins Okazaki fragments on the lagging strand.", "DNA replication") },
  { good: true, note: "direction with primes", q: fill(GENE, "DNA polymerase III adds nucleotides in the ____ direction.", "5′ to 3′", "DNA polymerase III adds nucleotides in the 5′ to 3′ direction.", "DNA replication", ["5' to 3'"]) },
  { good: true, note: "binomial name", q: mcq(GENE, "Which bacterium divides about every 20 minutes in ideal conditions?", ["Escherichia coli", "Staphylococcus aureus", "Bacillus subtilis", "Vibrio cholerae"], "Escherichia coli", "Escherichia coli divides about every 20 minutes in ideal conditions.", "Bacteria") },
  { good: true, note: "paraphrased prompt, fill", q: fill(CELL, "Water moving across a partially permeable membrane towards higher solute concentration is called ____.", "osmosis", "Osmosis is the net movement of water molecules across a partially permeable membrane.", "Osmosis") },
  { good: true, note: "bare letter answer", q: mcq(GENE, "How many bases does DNA contain?", ["Two", "Four", "Six", "Eight"], "B", "DNA contains four bases: adenine, thymine, guanine and cytosine.", "Nucleic acids") },

  // ---- BAD ----
  { good: false, note: "wrong key: hypertonic effect given for hypotonic (MCQ)", q: mcq(CELL, "What happens to a cell placed in a hypotonic solution?", ["It gains water and may burst", "It loses water and shrinks", "It stays exactly the same", "It loses all of its solutes"], "It loses water and shrinks", "In a hypotonic solution the cell loses water and shrinks.", "Osmosis") },
  { good: false, note: "wrong key with an explanation copied from the passage (MCQ)", q: mcq(CELL, "What happens to a cell placed in a hypotonic solution?", ["It gains water and may burst", "It loses water and shrinks", "It stays exactly the same", "It loses all of its solutes"], "It loses water and shrinks", "A cell placed in a hypotonic solution loses water and shrinks.", "Osmosis") },
  { good: false, note: "wrong key: hypotonic for the hypertonic sentence (fill)", q: fill(CELL, "In a ____ solution it loses water and shrinks.", "hypotonic", "A cell loses water and shrinks in this solution.", "Osmosis") },
  { good: false, note: "wrong key: mitosis for the meiosis sentence (fill)", q: fill(CELL, "____ produces four genetically different haploid gametes.", "Mitosis", "Mitosis produces four genetically different haploid gametes.", "Cell division") },
  { good: false, note: "wrong key: efferent direction (fill)", q: fill(NEURO, "Afferent neurons carry impulses ____ the central nervous system.", "away from", "Afferent neurons carry impulses away from the central nervous system.", "Neurons") },
  { good: false, note: "wrong number from the same sentence (fill)", q: fill(CHEM, "Enzymes in the human body work best at ____.", "45 °C", "Enzymes in the human body work best at 45 °C.", "Enzymes") },
  { good: false, note: "reversed direction (fill)", q: fill(GENE, "DNA polymerase III adds nucleotides in the ____ direction.", "3′ to 5′", "DNA polymerase III adds nucleotides in the 3′ to 5′ direction.", "DNA replication") },
  { good: false, note: "two right options (Two / 2)", q: mcq(CELL, "How many daughter cells does mitosis produce?", ["Two", "2", "Four", "Eight"], "Two", "Mitosis produces two genetically identical diploid daughter cells.", "Cell division") },
  { good: false, note: "two right options (same option twice)", q: mcq(GENE, "Which base replaces thymine in RNA?", ["Uracil", "uracil.", "Cytosine", "Guanine"], "Uracil", "In RNA, uracil replaces thymine.", "Nucleic acids") },
  { good: false, note: "wrong number", q: mcq(CHEM, "Above what temperature do most enzymes denature?", ["Above 40 °C", "Above 37 °C", "Above 60 °C", "Above 20 °C"], "Above 40 °C", "Most enzymes denature above 40 °C.", "Enzymes") },
  { good: false, note: "sign flipped", q: mcq(NEURO, "What is the resting membrane potential of a typical neuron?", ["+70 mV", "+40 mV", "−40 mV", "0 mV"], "+70 mV", "The resting potential of a neuron is +70 mV.", "Membrane potential") },
  { good: false, note: "wrong formula", q: fill(CHEM, "Glucose has the formula ____.", "C₆H₁₂O₅", "Glucose has the formula C₆H₁₂O₅.", "Respiration") },
  { good: false, note: "wrong ion (K⁺ not in passage)", q: mcq(NEURO, "Which ions flow into the cell during depolarisation?", ["K⁺ ions", "Na⁺ ions", "Ca²⁺ ions", "Cl⁻ ions"], "K⁺ ions", "During depolarisation K⁺ ions flow into the cell.", "Action potential") },
  { good: false, note: "invented term (fill answer not in passage)", q: fill(CELL, "Osmosis depends on the difference in ____ between two regions.", "water potential", "Osmosis depends on water potential.", "Osmosis") },
  { good: false, note: "outside knowledge (organelle not in notes)", q: mcq(CELL, "Which organelle makes ATP?", ["Mitochondrion", "Ribosome", "Nucleus", "Vacuole"], "Mitochondrion", "The mitochondrion makes ATP by respiration.", "Organelles") },
  { good: false, note: "cites a passage that wasn't sent", q: { ...mcq(GENE, "Which base replaces thymine in RNA?", ["Uracil", "Adenine", "Cytosine", "Guanine"], "Uracil", "In RNA, uracil replaces thymine.", "Nucleic acids"), passage: "p7" } },
  { good: false, note: "cites the wrong passage", q: { ...mcq(GENE, "Which base replaces thymine in RNA?", ["Uracil", "Adenine", "Cytosine", "Guanine"], "Uracil", "In RNA, uracil replaces thymine.", "Nucleic acids"), passage: "p1" } },
  { good: false, note: "wrong species", q: mcq(GENE, "Which bacterium divides about every 20 minutes in ideal conditions?", ["Staphylococcus aureus", "Escherichia coli", "Bacillus subtilis", "Vibrio cholerae"], "Staphylococcus aureus", "Staphylococcus aureus divides about every 20 minutes.", "Bacteria") },
  { good: false, note: "guessable blank", q: fill(GENE, "In RNA, uracil replaces thymine, so RNA has ____ instead of thymine.", "uracil", "In RNA, uracil replaces thymine.", "Nucleic acids") },
  { good: false, note: "all of the above", q: mcq(GENE, "Which of these is a base in DNA?", ["Adenine", "Thymine", "Guanine", "All of the above"], "All of the above", "DNA contains four bases: adenine, thymine, guanine and cytosine.", "Nucleic acids") },
  { good: false, note: "two blanks", q: fill(GENE, "In ____, ____ replaces thymine.", "RNA", "In RNA, uracil replaces thymine.", "Nucleic acids") },
  { good: false, note: "explanation from outside knowledge", q: mcq(NEURO, "Which channels open during depolarisation?", ["Voltage-gated sodium channels", "Potassium leak channels", "Chloride channels", "Calcium pumps"], "Voltage-gated sodium channels", "The sodium-potassium pump then moves 3 Na⁺ out and 2 K⁺ in using ATP.", "Action potential") },
  { good: false, note: "wrong enzyme (polymerase joins fragments)", q: fill(GENE, "The enzyme DNA ____ joins Okazaki fragments on the lagging strand.", "polymerase", "The enzyme DNA polymerase joins Okazaki fragments.", "DNA replication") },
];

function quizStats() {
  const rows = QUIZ.map((c) => {
    const out = normaliseQuizWithStats({ questions: [c.q] }, PASSAGES, { kind: "mixed", max: 15 });
    return { ...c, kept: (out?.questions.length ?? 0) === 1, issue: out?.issues[0] ?? null };
  });
  return {
    rows,
    goodKept: rows.filter((r) => r.good && r.kept).length,
    good: rows.filter((r) => r.good).length,
    badDropped: rows.filter((r) => !r.good && !r.kept).length,
    bad: rows.filter((r) => !r.good).length,
    falseDrops: rows.filter((r) => r.good && !r.kept).map((r) => `${r.note} (${r.issue})`),
    falseKeeps: rows.filter((r) => !r.good && r.kept).map((r) => r.note),
  };
}

// ---- chat ----
type ChatCase = { answer: string; good: boolean; note: string };
const CHAT: ChatCase[] = [
  // ---- GOOD ----
  { good: true, note: "definition", answer: "Osmosis is the net movement of water molecules across a partially permeable membrane [p1]." },
  { good: true, note: "paraphrase", answer: "In a hypotonic solution a cell takes in water and may burst [p1]." },
  { good: true, note: "negative and positive mV", answer: "A neuron rests at −70 mV and the action potential peaks at about +40 mV [p2]." },
  { good: true, note: "ion with charge", answer: "During depolarisation, voltage-gated sodium channels open and Na⁺ flows into the cell [p2]." },
  { good: true, note: "formula", answer: "Glucose is C₆H₁₂O₆ [p3]." },
  { good: true, note: "equation", answer: "Aerobic respiration: C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O [p3]." },
  { good: true, note: "plain-digit formula", answer: "The formula of glucose is C6H12O6 [p3]." },
  { good: true, note: "temperature", answer: "Enzymes in the body work best at 37 °C, and most denature above 45 °C [p3]." },
  { good: true, note: "two passages in one sentence", answer: "Na⁺ ions flow in during depolarisation [p2], and nitrate is taken up by roots [p3]." },
  { good: true, note: "ref after the full stop", answer: "In RNA, uracil replaces thymine. [p4]" },
  { good: true, note: "primes", answer: "DNA polymerase III adds nucleotides in the 5′ to 3′ direction [p4]." },
  { good: true, note: "binomial", answer: "Escherichia coli divides about every 20 minutes in ideal conditions [p4]." },
  { good: true, note: "bold term", answer: "**DNA ligase** joins Okazaki fragments on the lagging strand [p4]." },
  { good: true, note: "list item", answer: "- Afferent neurons carry impulses towards the central nervous system [p2]." },

  // ---- BAD ----
  { good: false, note: "no citation", answer: "Osmosis is the net movement of water molecules across a partially permeable membrane." },
  { good: false, note: "cites a passage that wasn't sent", answer: "Osmosis is the net movement of water molecules across a partially permeable membrane [p9]." },
  { good: false, note: "cites the wrong passage", answer: "In RNA, uracil replaces thymine [p1]." },
  { good: false, note: "wrong number", answer: "The action potential peaks at about +50 mV [p2]." },
  { good: false, note: "sign flipped", answer: "The resting membrane potential of a typical neuron is +70 mV [p2]." },
  { good: false, note: "wrong formula", answer: "Glucose has the formula C₆H₁₂O₅ [p3]." },
  { good: false, note: "outside knowledge with a citation", answer: "The sodium-potassium pump moves 3 Na⁺ out and 2 K⁺ in for every ATP [p2]." },
  { good: false, note: "invented term", answer: "Osmosis is driven by aquaporin proteins in the membrane [p1]." },
  { good: false, note: "wrong species", answer: "Staphylococcus aureus divides about every 20 minutes [p4]." },
  { good: false, note: "wrong ion", answer: "During depolarisation K⁺ ions flow into the cell [p2]." },
  { good: false, note: "exam prediction / opinion", answer: "This will definitely come up in your exam, so learn it well [p1]." },
  { good: false, note: "swapped: efferent towards the CNS", answer: "Efferent neurons carry impulses towards the central nervous system [p2]." },
  { good: false, note: "swapped: mitosis makes haploid gametes", answer: "Mitosis produces four genetically different haploid gametes [p1]." },
  { good: false, note: "swapped: denature at 37 °C", answer: "Most enzymes denature above 37 °C [p3]." },
  { good: false, note: "reversed direction", answer: "DNA polymerase III adds nucleotides in the 3′ to 5′ direction [p4]." },
  { good: false, note: "HTML and a script link around a true sentence", answer: "<img src=x onerror=alert(1)>Osmosis is the net movement of water molecules [p1]. [Click](javascript:alert(1))" },
];

function chatStats() {
  const rows = CHAT.map((c) => {
    const out = normaliseChatReply({ covered: true, answer: c.answer }, PASSAGES);
    return { ...c, kept: out?.kind === "answer" };
  });
  return {
    rows,
    goodKept: rows.filter((r) => r.good && r.kept).length,
    good: rows.filter((r) => r.good).length,
    badDropped: rows.filter((r) => !r.good && !r.kept).length,
    bad: rows.filter((r) => !r.good).length,
    falseDrops: rows.filter((r) => r.good && !r.kept).map((r) => r.note),
    falseKeeps: rows.filter((r) => !r.good && r.kept).map((r) => r.note),
  };
}

describe("QA accuracy sample: quiz questions", () => {
  it("reports kept and dropped", () => {
    const s = quizStats();
    console.info(`quiz: ${s.goodKept}/${s.good} good kept, ${s.badDropped}/${s.bad} bad dropped`, { falseDrops: s.falseDrops, falseKeeps: s.falseKeeps });
    expect(s.falseDrops).toEqual([]);
    // Known gap (docs/qa/step-3.md): a multiple-choice key taken from the neighbouring clause, with
    // an explanation that paraphrases it, can't be told from a right one without understanding the
    // sentence. Before the QA step 3 fixes, 7 of the first 22 bad questions got through.
    expect(s.falseKeeps).toEqual(["wrong key: hypertonic effect given for hypotonic (MCQ)"]);
    expect(`${s.goodKept}/${s.good} ${s.badDropped}/${s.bad}`).toBe("18/18 22/23");
  });
});

describe("QA accuracy sample: chat answers", () => {
  it("reports kept and dropped", () => {
    const s = chatStats();
    console.info(`chat: ${s.goodKept}/${s.good} good kept, ${s.badDropped}/${s.bad} bad dropped`, { falseDrops: s.falseDrops, falseKeeps: s.falseKeeps });
    expect(s.falseDrops).toEqual([]);
    // Before QA step 3: 4 bad sentences got through (wrong species and three swapped terms).
    expect(s.falseKeeps).toEqual(["HTML and a script link around a true sentence"]);
    expect(`${s.goodKept}/${s.good} ${s.badDropped}/${s.bad}`).toBe("14/14 15/16");
    // That one is kept on purpose: its true, cited sentence stays, and the markup does not.
    const html = normaliseChatReply({ covered: true, answer: CHAT.at(-1)!.answer }, PASSAGES);
    expect(html?.kind === "answer" && html.content).toBe("Osmosis is the net movement of water molecules. [1]");
  });
});

describe("contradictsPassage: a passage term swapped into a copied run", () => {
  it("finds swapped terms and numbers", () => {
    expect(swapIn("Efferent neurons carry impulses towards the central nervous system.", NEURO.text)).toEqual(["efferent", "afferent"]);
    expect(swapIn("Mitosis produces four genetically different haploid gametes.", CELL.text)).toEqual(["mitosis", "meiosis"]);
    expect(contradictsPassage("Enzymes in the human body work best at 45 °C.", CHEM.text)).toBe(true);
    expect(contradictsPassage("Most enzymes denature above 37 °C.", CHEM.text)).toBe(true);
    expect(contradictsPassage("DNA polymerase III adds nucleotides in the 3′ to 5′ direction.", GENE.text)).toBe(true);
  });
  it("leaves paraphrases, pronouns, shortened sentences and other clauses alone", () => {
    for (const ok of [
      "Mitochondria have a double membrane.",
      "Normal blood pH is 7.35–7.45, e.g. in arterial blood.",
      "Enzymes work best at body temperature, 37 °C.",
      "A cell in a hypertonic solution loses water and shrinks.",
      "Mitosis produces two genetically identical cells.",
      "Efferent neurons carry impulses away from the central nervous system.",
      "The bases are adenine, guanine, cytosine and thymine.",
      "In RNA, uracil replaces thymine.",
    ]) expect(swapIn(ok, [CELL, NEURO, CHEM, GENE].map((p) => p.text).join("\n") + " Mitochondria produce ATP. They have a double membrane. Normal arterial blood pH is 7.35–7.45. Enzymes work best at this temperature."), ok).toBeNull();
  });
  it("stays fast on long passages", () => {
    const long = Array.from({ length: 200 }, (_, i) => `Cell ${i} makes protein ${i} in the cytoplasm.`).join(" ");
    const t = performance.now();
    contradictsPassage("Cell 5 makes protein 7 in the cytoplasm of every cell in the tissue.", long);
    expect(performance.now() - t).toBeLessThan(500);
  });
});
