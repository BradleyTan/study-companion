// Question order, option shuffling and scoring (quiz-builder.md, quiz.md). Pure.

export type QuestionType = "mcq" | "fill";
/** The blank in a fill-in prompt. */
export const BLANK = "____";
export type QuizKind = "mcq" | "fill" | "mixed";
export const QUIZ_KINDS = ["mcq", "fill", "mixed"] as const;
export const QUIZ_COUNTS = [5, 10, 15] as const;
export type QuizCount = (typeof QUIZ_COUNTS)[number];

/** A random integer in [0, n), from `rng` (0 ≤ rng() < 1). */
const pick = (n: number, rng: () => number) => Math.min(n - 1, Math.floor(rng() * n));

/** Fisher–Yates shuffle (a new array). */
export function shuffle<T>(list: readonly T[], rng: () => number = Math.random): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = pick(i + 1, rng);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** A shuffled order of 0..n-1. */
export const permutation = (n: number, rng: () => number = Math.random) => shuffle(Array.from({ length: n }, (_, i) => i), rng);

/**
 * Mixed quizzes: never three of one type in a row when it can be avoided. Keeps the
 * relative order inside each type; starts with the bigger group so it never runs out first.
 */
export function interleave<T extends { type: QuestionType }>(list: readonly T[]): T[] {
  const mcq = list.filter((q) => q.type === "mcq");
  const fill = list.filter((q) => q.type === "fill");
  const out: T[] = [];
  while (mcq.length || fill.length) {
    const last2 = out.slice(-2);
    const run = last2.length === 2 && last2[0].type === last2[1].type ? last2[0].type : null;
    let take: QuestionType;
    if (!mcq.length) take = "fill";
    else if (!fill.length) take = "mcq";
    else if (run) take = run === "mcq" ? "fill" : "mcq";
    else take = mcq.length >= fill.length ? "mcq" : "fill";
    out.push((take === "mcq" ? mcq : fill).shift()!);
  }
  return out;
}

/** True when the list has three of one type in a row. */
export function hasRunOfThree(list: readonly { type: QuestionType }[]): boolean {
  for (let i = 2; i < list.length; i++) if (list[i].type === list[i - 1].type && list[i].type === list[i - 2].type) return true;
  return false;
}

export type AttemptSlot = { q: string; o: number[] | null };

/**
 * The order of one attempt: each question's id and, for multiple choice, the order its four
 * options are shown in. The first attempt keeps the quiz's own order; a retake reshuffles the
 * questions (re-interleaved for mixed quizzes). Options are reshuffled every time.
 */
export function attemptOrder(questions: readonly { id: string; type: QuestionType; options: readonly string[] | null }[], retake: boolean, rng: () => number = Math.random): AttemptSlot[] {
  let list = [...questions];
  if (retake) {
    list = shuffle(list, rng);
    if (list.some((q) => q.type === "mcq") && list.some((q) => q.type === "fill")) list = interleave(list);
  }
  return list.map((q) => ({ q: q.id, o: q.type === "mcq" && q.options ? permutation(q.options.length, rng) : null }));
}

/** Score band of the results screen (quiz.md "Results"). */
export type Band = "brilliant" | "nice" | "getting" | "practice";
export function band(score: number, total: number): Band {
  const p = total ? score / total : 0;
  if (p >= 0.9) return "brilliant";
  if (p >= 0.7) return "nice";
  if (p >= 0.5) return "getting";
  return "practice";
}
export const BAND_TITLE: Record<Band, string> = { brilliant: "Brilliant!", nice: "Nicely done!", getting: "Getting there!", practice: "Good practice." };
export const celebrates = (b: Band) => b === "brilliant" || b === "nice";

/** "Best 8/10" chips use ≥ 70 % for the success fill. */
export const isGoodScore = (score: number, total: number) => total > 0 && score / total >= 0.7;

export const KIND_LABEL: Record<QuizKind, string> = { mcq: "Multiple choice", fill: "Fill in the blank", mixed: "Mixed" };

/**
 * Quiz title, built by the server, never the AI: "Lecture 3.pdf · pages 1–20 · Mixed",
 * "Cell structure · Multiple choice", "All of Biology · Fill in the blank", "Weak topics · Mixed".
 */
export function quizTitle(source: { kind: "note" | "file" | "all" | "weak"; name: string; range?: string | null }, kind: QuizKind): string {
  const base = source.kind === "all" ? `All of ${source.name}` : source.kind === "weak" ? "Weak topics" : source.name;
  return [base, source.range ?? null, KIND_LABEL[kind]].filter(Boolean).join(" · ").slice(0, 200);
}

/** Headings that rotate without repeating twice in a row. */
export const CORRECT_HEADINGS = ["Correct!", "Nailed it!", "Yes! That's it."] as const;
export const WRONG_HEADINGS = ["Not quite. You'll get it next time.", "Close one. You'll get it next time.", "Not this time. Now you know!"] as const;
export function nextHeading<T extends string>(list: readonly T[], last: string | null, rng: () => number = Math.random): T {
  const options = list.filter((h) => h !== last);
  return options[pick(options.length, rng)];
}
