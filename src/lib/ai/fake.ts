// Deterministic local stand-in for the AI, used when no AI key is configured (demo mode,
// CI, local development). Same input, same output, no network. It returns the same JSON
// shape the real model is asked for, so it goes through the same validation.
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
