// Validation of the model's quiz (quiz-builder.md "Quality rules the developer must match").
// Same approach as normaliseFlashcardsWithStats: shape-checked with zod, every passage ref
// mapped through the server's own list, answers grounded in the cited passage, and weak
// questions dropped, never replaced.
import { z } from "zod";
import { interleave, type QuizKind } from "../quiz/order";
import { topicKey, TOPIC_MAX } from "../quiz/weak";
import { bestSentence, groundedNearQuote, isGrounded, QUOTE_MAX, resolvePassage, wrongRangeEnd } from "./schemas";
import { canonical, clip, collapse, containsLoose, normaliseFront, numbersIn, passageFacts, stem, words } from "./text";
import type { GeneratedQuestion, Passage } from "./types";

export const QUESTION_PROMPT_MAX = 300;
export const OPTION_MAX = 160;
export const FILL_ANSWER_MAX = 60;
export const FILL_ANSWER_WORDS = 4;
export const ACCEPTED_MAX = 3;
export const EXPLANATION_MAX = 400;
/** Fewer good questions than this and the quiz counts as "too little text" (go refunded). */
export const MIN_GOOD_QUESTIONS = 3;
export const BLANK = "____";

const ref = z.union([z.string(), z.number()]).transform(String);
const text = z.union([z.string(), z.number()]).transform(String);

export const rawQuiz = z.object({
  questions: z.array(z.object({
    type: z.string().optional(),
    prompt: z.string(),
    options: z.array(text).max(10).nullish(),
    answer: text,
    accepted: z.array(text).max(10).nullish(),
    passage: ref.nullish(),
    quote: z.string().nullish(),
    topic: z.string().nullish(),
    explanation: z.string().nullish(),
  }).loose()).max(60),
});

/** Why a question was dropped (for tests and stats). */
export type QuestionIssue =
  | "type" | "short" | "passage" | "ungrounded" | "options" | "banned_option" | "no_single_answer" | "giveaway_length"
  | "blank" | "answer_length" | "not_in_passage" | "guessable" | "topic" | "explanation" | "duplicate";

const BANNED_OPTION = /\b(?:all|none|both|neither) of (?:the )?(?:above|these|them|those)\b|\bboth [a-d] and [a-d]\b|^[a-d] (?:and|&) [a-d]$|^(?:all|none) (?:above)?$/i;

/** "_____", "[blank]", "(blank)" or "......" all become one standard blank. */
export function standardBlanks(prompt: string): string {
  return prompt.replace(/_{2,}|\[\s*blank\s*\]|\(\s*blank\s*\)|\.{4,}|…{2,}/gi, BLANK);
}
const countBlanks = (s: string) => s.split(BLANK).length - 1;

const optionKey = (s: string) => normaliseFront(s).replace(/^(?:the|a|an)\s+/, "");

/** Content words, stemmed (for "is the answer already in the sentence?"). */
const stems = (s: string) => new Set(words(s).map(stem));

/** Every number in `s` must be in the passage (questions may not invent figures either). */
function numbersGrounded(s: string, passageText: string): boolean {
  const p = passageFacts(passageText);
  return numbersIn(s).every((n) => p.numbers.has(n) || p.numbers.has(n.replace(/^-/, "")));
}

function answerInPassage(answer: string, passageText: string): boolean {
  return containsLoose(passageText, answer) || canonical(collapse(passageText)).includes(canonical(collapse(answer)));
}

/** Word-set overlap, for near-duplicate prompts ("What makes ATP?" / "What makes the ATP?"). */
function similar(a: string, b: string): boolean {
  const x = stems(a);
  const y = stems(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both) >= 0.8;
}

export type NormalisedQuiz = { questions: GeneratedQuestion[]; dropped: number; issues: QuestionIssue[] };

/**
 * Validates and cleans the model's quiz. `topics` are the subject's existing topic names: a
 * question's topic that matches one (case-insensitively, trimmed) takes that spelling. Null when
 * the reply isn't usable at all.
 */
export function normaliseQuizWithStats(json: unknown, passages: Passage[], opts: { kind: QuizKind; max: number; topics?: string[] }): NormalisedQuiz | null {
  const parsed = rawQuiz.safeParse(json);
  if (!parsed.success) return null;
  const known = new Map((opts.topics ?? []).map((t) => [topicKey(t), clip(t, TOPIC_MAX)]));
  const out: GeneratedQuestion[] = [];
  const issues: QuestionIssue[] = [];
  const drop = (i: QuestionIssue) => { issues.push(i); };

  for (const q of parsed.data.questions) {
    if (out.length >= opts.max) break;
    const options = (q.options ?? []).map((o) => clip(o, OPTION_MAX));
    const type: "mcq" | "fill" | null = /^(?:mcq|multiple|choice|multiple[ _-]?choice)/i.test(q.type ?? "")
      ? "mcq"
      : /^(?:fill|blank|gap|cloze)/i.test(q.type ?? "") ? "fill" : options.length ? "mcq" : q.prompt.includes("__") ? "fill" : null;
    if (!type || (opts.kind !== "mixed" && type !== opts.kind)) { drop("type"); continue; }

    let prompt = clip(type === "fill" ? standardBlanks(q.prompt) : q.prompt, QUESTION_PROMPT_MAX);
    const answerRaw = clip(q.answer, type === "fill" ? FILL_ANSWER_MAX + 20 : OPTION_MAX);
    if (prompt.length < 12 || !answerRaw) { drop("short"); continue; }

    // A cited passage must be one we sent; citing any other is dropped. Without a citation, find
    // the passage the quote actually came from.
    const quote = q.quote ? collapse(q.quote) : "";
    let passage = resolvePassage(q.passage, passages);
    if (!passage && q.passage) { drop("passage"); continue; }
    if (!passage && quote) passage = passages.find((p) => containsLoose(p.text, quote)) ?? null;
    if (!passage) { drop("passage"); continue; }
    const modelQuote = quote && quote.length <= 600 && containsLoose(passage.text, quote) ? quote : null;

    let answer = answerRaw;
    let finalOptions: string[] | null = null;
    let correctIndex: number | null = null;
    let accepted: string[] = [];

    if (type === "mcq") {
      if (options.length !== 4 || options.some((o) => !o)) { drop("options"); continue; }
      if (new Set(options.map(optionKey)).size !== 4) { drop("options"); continue; }
      if (options.some((o) => BANNED_OPTION.test(o))) { drop("banned_option"); continue; }
      // "answer" repeats the right option; a bare letter ("B") is read as its position.
      let matches = options.map((o, i) => (optionKey(o) === optionKey(answer) ? i : -1)).filter((i) => i >= 0);
      if (!matches.length && /^[a-d]$/i.test(answer.trim())) matches = [answer.trim().toUpperCase().charCodeAt(0) - 65];
      if (matches.length !== 1) { drop("no_single_answer"); continue; }
      correctIndex = matches[0];
      answer = options[correctIndex];
      // The right option must not stand out as by far the longest.
      const others = options.filter((_, i) => i !== correctIndex).map((o) => o.length);
      if (answer.length > 2 * Math.max(...others) && answer.length - Math.max(...others) > 25) { drop("giveaway_length"); continue; }
      finalOptions = options;
    } else {
      if (countBlanks(prompt) !== 1) { drop("blank"); continue; }
      const n = answer.split(/\s+/).filter(Boolean).length;
      if (n > FILL_ANSWER_WORDS || answer.length > FILL_ANSWER_MAX) { drop("answer_length"); continue; }
      if (!answerInPassage(answer, passage.text)) { drop("not_in_passage"); continue; }
      // The blank must not be guessable from the sentence itself.
      const rest = prompt.replace(BLANK, " ");
      const restStems = stems(rest);
      const restNumbers = new Set(numbersIn(rest));
      if ([...stems(answer)].some((w) => restStems.has(w)) || numbersIn(answer).some((x) => restNumbers.has(x))) { drop("guessable"); continue; }
      const akey = optionKey(answer);
      accepted = [...new Set((q.accepted ?? []).map((a) => clip(a, FILL_ANSWER_MAX)).filter((a) => a && a.split(/\s+/).length <= FILL_ANSWER_WORDS && optionKey(a) !== akey))]
        .slice(0, ACCEPTED_MAX);
    }

    // Accuracy: the answer (and for fill-ins, the whole sentence) must come from the cited passage.
    const filled = type === "fill" ? prompt.replace(BLANK, answer) : answer;
    if (!isGrounded(answer, passage.text) || (type === "fill" && !isGrounded(filled, passage.text))) { drop("ungrounded"); continue; }
    if (!numbersGrounded(prompt, passage.text) || wrongRangeEnd(prompt, answer, passage.text) || !groundedNearQuote(prompt, answer, passage.text, modelQuote)) { drop("ungrounded"); continue; }

    const topicRaw = clip(q.topic ?? "", TOPIC_MAX);
    if (!topicRaw || !/[\p{L}\p{N}]/u.test(topicRaw)) { drop("topic"); continue; }
    const topic = known.get(topicKey(topicRaw)) ?? topicRaw;

    const explanation = clip(q.explanation ?? "", EXPLANATION_MAX);
    if (explanation.length < 8 || !isGrounded(explanation, passage.text)) { drop("explanation"); continue; }

    const key = normaliseFront(prompt.replace(BLANK, ""));
    if (out.some((o) => normaliseFront(o.prompt.replace(BLANK, "")) === key || similar(o.prompt, prompt) || (o.chunkId === passage.chunkId && optionKey(o.answer) === optionKey(answer) && o.type === type))) {
      drop("duplicate");
      continue;
    }

    const verified = modelQuote ? clip(modelQuote, QUOTE_MAX) : bestSentence(passage, `${prompt} ${answer}`);
    out.push({ type, prompt, options: finalOptions, correctIndex, answer, accepted, explanation, topic, chunkId: passage.chunkId, quote: verified });
  }
  return { questions: opts.kind === "mixed" ? interleave(out) : out, dropped: issues.length, issues };
}

/** Same, questions only (null when the reply isn't usable). */
export function normaliseQuiz(json: unknown, passages: Passage[], opts: { kind: QuizKind; max: number; topics?: string[] }): GeneratedQuestion[] | null {
  return normaliseQuizWithStats(json, passages, opts)?.questions ?? null;
}
