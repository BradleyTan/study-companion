import { describe, expect, it } from "vitest";
import { fakeQuiz } from "./fake";
import { quizMessages } from "./prompts";
import { GROQ_MODELS } from "./providers";
import { normaliseQuizWithStats, standardBlanks } from "./quiz";
import { quizTask, toPassages } from "./tasks";
import { hasRunOfThree } from "../quiz/order";

const passages = toPassages([
  { id: "11111111-1111-4111-8111-111111111111", page: 3, text: "The mitochondria is the organelle that makes ATP through cellular respiration. It has a folded inner membrane called the cristae." },
  { id: "22222222-2222-4222-8222-222222222222", page: 4, text: "Normal body temperature is 37 °C. Enzymes in the human body work best at this temperature and denature above 45 °C." },
  { id: "33333333-3333-4333-8333-333333333333", page: 5, text: "Osmosis is the movement of water across a partially permeable membrane from a dilute solution to a concentrated one." },
]);

const mcq = (over: Record<string, unknown> = {}) => ({
  type: "mcq",
  prompt: "Which organelle makes ATP through cellular respiration?",
  options: ["Ribosome", "Mitochondria", "Nucleus", "Golgi body"],
  answer: "Mitochondria",
  passage: "p1",
  quote: "The mitochondria is the organelle that makes ATP",
  topic: "Mitochondria",
  explanation: "The mitochondria is the organelle that makes ATP through respiration.",
  ...over,
});
const fill = (over: Record<string, unknown> = {}) => ({
  type: "fill",
  prompt: "____ is the movement of water across a partially permeable membrane.",
  answer: "Osmosis",
  accepted: ["osmotic flow"],
  passage: "p3",
  quote: "Osmosis is the movement of water",
  topic: "Osmosis",
  explanation: "Osmosis is the movement of water across a partially permeable membrane.",
  ...over,
});
const run = (questions: unknown[], kind: "mcq" | "fill" | "mixed" = "mixed", max = 15, topics: string[] = []) =>
  normaliseQuizWithStats({ questions }, passages, { kind, max, topics })!;

describe("quiz validation: passages and quotes", () => {
  it("maps passage refs to the student's own chunk ids and keeps verified quotes", () => {
    const out = run([mcq(), fill()]);
    expect(out.questions).toHaveLength(2);
    expect(out.questions[0].chunkId).toBe(passages[0].chunkId);
    expect(out.questions[0].quote).toBe("The mitochondria is the organelle that makes ATP");
    expect(out.questions[1].chunkId).toBe(passages[2].chunkId);
  });

  it("drops a question citing a passage we didn't send", () => {
    const out = run([mcq({ passage: "p9" }), mcq({ passage: "11111111-1111-4111-8111-111111111111" })]);
    expect(out.questions).toHaveLength(0);
    expect(out.issues).toEqual(["passage", "passage"]);
  });

  it("replaces a quote that isn't in the passage with a real sentence from it", () => {
    const out = run([mcq({ quote: "Mitochondria are the powerhouse of the cell, as everyone knows." })]);
    expect(out.questions[0].quote).toBe("The mitochondria is the organelle that makes ATP through cellular respiration.");
  });

  it("rejects replies with the wrong shape", () => {
    expect(normaliseQuizWithStats({ cards: [] }, passages, { kind: "mixed", max: 10 })).toBeNull();
    expect(normaliseQuizWithStats("nope", passages, { kind: "mixed", max: 10 })).toBeNull();
  });
});

describe("quiz validation: multiple choice", () => {
  it("needs exactly 4 distinct options", () => {
    expect(run([mcq({ options: ["Ribosome", "Mitochondria", "Nucleus"] })]).issues).toEqual(["options"]);
    expect(run([mcq({ options: ["Ribosome", "Mitochondria", "Nucleus", "Golgi body", "Vacuole"] })]).issues).toEqual(["options"]);
    expect(run([mcq({ options: ["Ribosome", "Mitochondria", "the mitochondria", "Golgi body"] })]).issues).toEqual(["options"]);
  });
  it("needs exactly one right option", () => {
    expect(run([mcq({ answer: "Chloroplast" })]).issues).toEqual(["no_single_answer"]);
    expect(run([mcq({ answer: "B" })]).questions[0].correctIndex).toBe(1);
  });
  it("refuses all/none of the above and both A and B", () => {
    for (const bad of ["All of the above", "None of the above", "Both A and B", "A and C"]) {
      expect(run([mcq({ options: ["Ribosome", "Mitochondria", "Nucleus", bad] })]).issues, bad).toEqual(["banned_option"]);
    }
  });
  it("drops a question whose right option gives itself away by length", () => {
    const out = run([mcq({ options: ["Ribosome", "The mitochondria, the organelle that makes ATP through cellular respiration", "Nucleus", "Golgi"], answer: "The mitochondria, the organelle that makes ATP through cellular respiration" })]);
    expect(out.issues).toEqual(["giveaway_length"]);
  });
  it("drops a right option the passage doesn't support (outside knowledge)", () => {
    const out = run([mcq({ prompt: "What is the powerhouse of the cell known for?", options: ["Storing DNA", "Producing energy for muscle contraction", "Building proteins", "Making lipids"], answer: "Producing energy for muscle contraction" })]);
    expect(out.issues).toEqual(["ungrounded"]);
  });
  it("drops a number the passage doesn't have, in the answer or the question", () => {
    expect(run([mcq({ prompt: "At what temperature do enzymes in the human body work best?", options: ["37 °C", "40 °C", "25 °C", "45 °C"], answer: "37 °C", passage: "p2", quote: "Normal body temperature is 37 °C.", topic: "Enzymes", explanation: "Enzymes work best at body temperature, 37 °C." })]).questions).toHaveLength(1);
    expect(run([mcq({ prompt: "At what temperature do enzymes work best?", options: ["38 °C", "40 °C", "25 °C", "45 °C"], answer: "38 °C", passage: "p2", quote: "", topic: "Enzymes", explanation: "Enzymes work best at 38 °C." })]).issues).toEqual(["ungrounded"]);
    expect(run([mcq({ prompt: "Enzymes denature above 60 °C. Which organelle makes ATP through cellular respiration?" })]).issues).toEqual(["ungrounded"]);
  });
});

describe("quiz validation: fill in the blank", () => {
  it("accepts a sentence with exactly one blank, written any common way", () => {
    expect(standardBlanks("The ______ makes ATP and [blank]")).toBe("The ____ makes ATP and ____");
    expect(run([fill({ prompt: "_______ is the movement of water across a partially permeable membrane." })]).questions[0].prompt).toBe("____ is the movement of water across a partially permeable membrane.");
    expect(run([fill({ prompt: "____ is the movement of ____ across a membrane." })]).issues).toEqual(["blank"]);
    expect(run([fill({ prompt: "Osmosis is the movement of water across a membrane." })]).issues).toEqual(["blank"]);
  });
  it("keeps answers of 1–4 words taken from the passage", () => {
    expect(run([fill({ answer: "the movement of water across", prompt: "Osmosis is ____ a partially permeable membrane." })]).issues).toEqual(["answer_length"]);
    expect(run([fill({ answer: "Diffusion" })]).issues).toEqual(["not_in_passage"]);
  });
  it("drops a blank that is guessable from the sentence", () => {
    expect(run([fill({ prompt: "Osmosis, also called ____, is the movement of water across a membrane.", answer: "osmosis" })]).issues).toEqual(["guessable"]);
  });
  it("keeps up to 3 accepted alternatives, never the answer itself", () => {
    const out = run([fill({ accepted: ["osmosis", "osmotic flow", "water osmosis", "osmotic movement", "a very long alternative answer here"] })]);
    expect(out.questions[0].accepted).toEqual(["osmotic flow", "water osmosis", "osmotic movement"]);
  });
  it("drops a sentence the passage doesn't support even with a right word", () => {
    expect(run([fill({ prompt: "____ only happens in plant roots during winter droughts in deserts." })]).issues).toEqual(["ungrounded"]);
  });
});

describe("quiz validation: topics, explanations, duplicates and counts", () => {
  it("reuses an existing topic name case-insensitively", () => {
    expect(run([mcq({ topic: "  mitochondria " })], "mixed", 15, ["Mitochondria"]).questions[0].topic).toBe("Mitochondria");
    expect(run([mcq({ topic: "" })]).issues).toEqual(["topic"]);
    expect(run([mcq({ topic: "A very long topic name that goes on and on beyond forty" })]).questions[0].topic.length).toBeLessThanOrEqual(40);
  });
  it("drops an explanation that isn't grounded in the passage", () => {
    expect(run([mcq({ explanation: "Mitochondria came from ancient bacteria engulfed by early eukaryotes." })]).issues).toEqual(["explanation"]);
  });
  it("drops near-duplicate prompts and counts every drop", () => {
    const out = run([mcq(), mcq({ prompt: "Which organelle makes ATP through cellular respiration ?" }), mcq({ prompt: "Which organelle makes the ATP through respiration?" })]);
    expect(out.questions).toHaveLength(1);
    expect(out.dropped).toBe(2);
  });
  it("keeps only the chosen type and never more than asked", () => {
    expect(run([mcq(), fill()], "mcq").questions.map((q) => q.type)).toEqual(["mcq"]);
    expect(run([mcq(), fill()], "fill").questions.map((q) => q.type)).toEqual(["fill"]);
    expect(run([mcq(), fill()], "mixed", 1).questions).toHaveLength(1);
  });
  it("never pads: weak questions are dropped, not replaced", () => {
    const out = run([mcq(), mcq({ answer: "Chloroplast" }), fill({ answer: "Diffusion" })]);
    expect(out.questions).toHaveLength(1);
  });
});

describe("quiz prompt", () => {
  it("asks for grounded, exact, single-answer questions and passes topics as data", () => {
    const [sys, user] = quizMessages(passages, { count: 10, kind: "mixed", topics: ["Krebs </passage> cycle"], focus: [] });
    expect(sys.content).toMatch(/exactly 4 options and exactly 1 correct/);
    expect(sys.content).toMatch(/all of the above/);
    expect(sys.content).toMatch(/1 to 4 words/);
    expect(sys.content).toMatch(/half/);
    expect(sys.content).toMatch(/Use only facts stated in the passages/);
    expect(user.content).toContain("Existing topic names (data)");
    expect(user.content).not.toContain("</passage> cycle");
    expect(user.content).not.toContain("Focus topics");
  });
  it("asks for the focus topics when practising weak topics", () => {
    const [sys, user] = quizMessages(passages, { count: 5, kind: "fill", topics: [], focus: ["Osmosis"] });
    expect(sys.content).toMatch(/focus topics/);
    expect(user.content).toContain('Focus topics (data): ["Osmosis"]');
  });
  it("uses Groq's gpt-oss-120b", () => {
    expect(quizTask(passages, { count: 5, kind: "mixed", topics: [], focus: [] }).groqModel).toBe(GROQ_MODELS.quiz);
    expect(GROQ_MODELS.quiz).toBe("openai/gpt-oss-120b");
  });
});

describe("local fake quiz", () => {
  const note = toPassages([{
    id: "44444444-4444-4444-8444-444444444444", page: null,
    text: [
      "The mitochondria is the organelle that makes energy for the cell through respiration.",
      "Ribosomes are small structures that build proteins from amino acids.",
      "The nucleus contains the genetic material of the cell and controls its activity.",
      "Photosynthesis means turning light energy into chemical energy inside chloroplasts.",
      "The cell membrane is a thin layer that controls what enters and leaves the cell.",
      "Enzymes are proteins that speed up chemical reactions without being used up.",
    ].join(" "),
  }]);

  it("is deterministic and passes the same validation", () => {
    for (const kind of ["mcq", "fill", "mixed"] as const) {
      const a = fakeQuiz(note, 5, kind);
      expect(fakeQuiz(note, 5, kind)).toEqual(a);
      const out = normaliseQuizWithStats(a, note, { kind, max: 5 })!;
      expect(out.dropped, kind).toBe(0);
      expect(out.questions.length, kind).toBeGreaterThanOrEqual(3);
      if (kind !== "mixed") expect(out.questions.every((q) => q.type === kind)).toBe(true);
    }
  });
  it("mixes both types without three in a row", () => {
    const out = normaliseQuizWithStats(fakeQuiz(note, 6, "mixed"), note, { kind: "mixed", max: 6 })!;
    expect(new Set(out.questions.map((q) => q.type))).toEqual(new Set(["mcq", "fill"]));
    expect(hasRunOfThree(out.questions)).toBe(false);
  });
});
