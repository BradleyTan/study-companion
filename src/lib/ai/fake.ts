// Deterministic local stand-in for the AI, used when no AI key is configured (demo mode,
// CI, local development). Same input, same output, no network. It returns the same JSON
// shape the real model is asked for, so it goes through the same validation.
import { keyTerms, keywordScore } from "../chat/retrieve";
import { clip, sentences, words } from "./text";
import type { Passage } from "./types";

const DEFINITION = /^(.{3,80}?)\s+(is|are|was|were|means|refers to|consists of|contains)\s+(.{3,})$/i;

function cardFrom(sentence: string): { front: string; back: string } | null {
  const s = sentence.replace(/[.!?]+$/, "");
  const def = DEFINITION.exec(s);
  if (def) {
    const subject = def[1].replace(/^(the|a|an)\s+/i, "");
    const verb = def[2].toLowerCase();
    const q = verb === "means" || verb === "refers to" ? `What does ${subject} ${verb === "means" ? "mean" : "refer to"}?` : `What ${verb} ${subject}?`;
    return { front: clip(q, 200), back: clip(def[3].charAt(0).toUpperCase() + def[3].slice(1) + ".", 400) };
  }
  // Fill-in-the-blank on the longest content word.
  const key = words(s).filter((w) => /^\p{L}+$/u.test(w)).sort((a, b) => b.length - a.length || a.localeCompare(b))[0];
  if (!key || key.length < 5) return null;
  const blanked = s.replace(new RegExp(`\\b${key}\\b`, "i"), "_____");
  if (blanked === s) return null;
  return { front: clip(`Fill in the blank: ${blanked}`, 200), back: key };
}

export function fakeFlashcards(passages: Passage[], count: number) {
  const cards: { front: string; back: string; passage: string; quote: string }[] = [];
  for (const p of passages) {
    for (const sen of sentences(p.text)) {
      if (sen.length < 25 || sen.length > 400) continue;
      const c = cardFrom(sen);
      if (c) cards.push({ ...c, passage: p.ref, quote: clip(sen, 200) });
      if (cards.length >= count) return { cards };
    }
  }
  return { cards };
}

function label(s: string): string {
  return clip(s.replace(/[.!?:;,]+$/, "").split(/\s+/).slice(0, 6).join(" "), 60);
}

export function fakeMindmap(passages: Passage[], subjectName: string) {
  const nodes: { id: string; label: string; parent: string | null; passage: string | null }[] = [
    { id: "n0", label: subjectName, parent: null, passage: null },
  ];
  for (const p of passages.slice(0, 8)) {
    const list = sentences(p.text);
    if (!list.length) continue;
    const topic = `n${nodes.length}`;
    nodes.push({ id: topic, label: label(list[0]), parent: "n0", passage: p.ref });
    for (const s of list.slice(1, 4)) {
      if (nodes.length >= 40) break;
      nodes.push({ id: `n${nodes.length}`, label: label(s), parent: topic, passage: p.ref });
    }
  }
  return { nodes };
}

// ---- quiz ---------------------------------------------------------------------

/** The longest letter-only word (5+ letters) that appears once in the sentence. */
function keyWord(s: string): string | null {
  const list = words(s).filter((w) => /^\p{L}+$/u.test(w) && w.length >= 5);
  const once = list.filter((w) => list.indexOf(w) === list.lastIndexOf(w));
  return once.sort((a, b) => b.length - a.length || a.localeCompare(b))[0] ?? null;
}

/** "The mitochondria is …" → "Mitochondria"; otherwise the sentence's two longest words. */
function fakeTopic(s: string): string {
  const def = DEFINITION.exec(s.replace(/[.!?]+$/, ""));
  const raw = def
    ? def[1].replace(/^(the|a|an)\s+/i, "").split(/\s+/).slice(0, 3).join(" ")
    : [...new Set(words(s).filter((w) => /^\p{L}+$/u.test(w)).map((w) => w.toLowerCase()))].sort((a, b) => b.length - a.length || a.localeCompare(b)).slice(0, 2).join(" ");
  return clip(raw.charAt(0).toUpperCase() + raw.slice(1), 40);
}

/**
 * Deterministic quiz from the passages: each usable sentence becomes a fill-in (its key word
 * blanked) or a multiple-choice question (which word fills the gap, with key words of other
 * sentences as the wrong options). Mixed alternates, starting with multiple choice.
 */
export function fakeQuiz(passages: Passage[], count: number, kind: "mcq" | "fill" | "mixed") {
  const all: { s: string; p: Passage; key: string }[] = [];
  for (const p of passages) {
    for (const s of sentences(p.text)) {
      if (s.length < 30 || s.length > 300) continue;
      const key = keyWord(s);
      if (key) all.push({ s, p, key });
    }
  }
  const questions: Record<string, unknown>[] = [];
  for (const { s, p, key } of all) {
    if (questions.length >= count) break;
    const blanked = s.replace(new RegExp(`\\b${key}\\b`, "i"), "____");
    if (blanked === s) continue;
    const wantMcq = kind === "mcq" || (kind === "mixed" && questions.length % 2 === 0);
    const base = { passage: p.ref, quote: clip(s, 200), topic: fakeTopic(s), explanation: clip(s, 400) };
    if (wantMcq) {
      const inSentence = new Set(words(s));
      const others = [...new Set(all.map((x) => x.key))]
        .filter((w) => w !== key && !inSentence.has(w))
        .sort((a, b) => Math.abs(a.length - key.length) - Math.abs(b.length - key.length) || a.localeCompare(b))
        .slice(0, 3);
      if (others.length === 3) {
        // The right option sits at a different place each time (the server shuffles again anyway).
        const options = [...others];
        options.splice(questions.length % 4, 0, key);
        questions.push({ type: "mcq", prompt: clip(`Which word fills the gap? “${blanked}”`, 300), options, answer: key, ...base });
        continue;
      }
      if (kind === "mcq") continue;
    }
    questions.push({ type: "fill", prompt: clip(blanked, 300), answer: key, accepted: [], ...base });
  }
  return { questions };
}

// ---- chat ---------------------------------------------------------------------

/**
 * Deterministic chat reply: the (up to 2) sentences of the passages that share the most key
 * words with the question, each cited, in reading order; "not covered" when none share any.
 * "Quiz me" blanks the key word of the first usable sentence and hides it as the answer.
 */
export function fakeChat(passages: Passage[], question: string, quiz: boolean) {
  if (quiz) {
    for (const p of passages) {
      for (const s of sentences(p.text)) {
        if (s.length < 30 || s.length > 300) continue;
        const key = keyWord(s);
        if (!key) continue;
        const blanked = s.replace(new RegExp(`\\b${key}\\b`, "i"), "____").replace(/[.!?]+$/, "");
        if (!blanked.includes("____")) continue;
        return { covered: true, answer: `Fill the gap: ${blanked} [${p.ref}].`, reveal: `${key.charAt(0).toUpperCase()}${key.slice(1)} [${p.ref}].` };
      }
    }
    return { covered: false, answer: "", reveal: null };
  }
  const terms = keyTerms(question);
  const scored: { s: string; ref: string; at: number; score: number }[] = [];
  let at = 0;
  for (const p of passages) {
    for (const s of sentences(p.text)) {
      const { coverage, hits } = keywordScore(terms, s);
      if (coverage > 0) scored.push({ s, ref: p.ref, at, score: coverage * 10 + hits });
      at++;
    }
  }
  const best = scored.sort((a, b) => b.score - a.score || a.at - b.at).slice(0, 2).sort((a, b) => a.at - b.at);
  if (!best.length) return { covered: false, answer: "", reveal: null };
  return { covered: true, answer: best.map((b) => `${b.s.replace(/[.!?]+$/, "")} [${b.ref}].`).join(" "), reveal: null };
}
