// Validation of the model's chat reply (chat.md "Grounding"). Accuracy over everything
// (Bradley): every sentence must cite a passage that was sent and be supported by it, refs are
// mapped through the server's own passage list (so a reply can only point at this student's
// text) and renumbered 1, 2, 3 in order of first use. Whatever is left is a tiny Markdown
// subset (paragraphs, "- " / "1. " lists, **bold**, [n] citations) that the screen renders as
// text, never as HTML.
import { z } from "zod";
import { bestSentence, isGrounded, QUOTE_MAX } from "../ai/schemas";
import { contradictsPassage } from "../ai/contradict";
import { clip, collapse, sentences } from "../ai/text";
import type { Passage } from "../ai/types";

/** Answers stay around 150 words (the prompt asks for that); anything past this is cut at a sentence. */
export const ANSWER_MAX_WORDS = 200;
export const CHAT_CONTENT_MAX = 3000;
export const REVEAL_MAX = 1000;

const text = z.union([z.string(), z.number()]).transform(String);
export const rawChatReply = z.object({
  covered: z.union([z.boolean(), z.string()]).nullish(),
  answer: text.nullish(),
  reveal: text.nullish(),
}).loose();

export type ChatCitationRef = { n: number; chunkId: string; quote: string };
export type ChatReply =
  | { kind: "answer"; content: string; reveal: string | null; citations: ChatCitationRef[]; dropped: number }
  | { kind: "not_covered"; dropped: number };

// A group of refs as the model writes them: [p2], [p1, p3], [P2; p4], [2], 【p1】, [passage 3].
const ONE_REF = String.raw`(?:p|passage)?\s*#?\s*\d{1,3}`;
const REF_GROUP = new RegExp(String.raw`[\[【]\s*(${ONE_REF}(?:\s*(?:,|;|&|and)\s*${ONE_REF})*)\s*[\]】]`, "gi");
// Private-use characters: never typed by students, removed from the model's text first.
const OPEN = "";
const CLOSE = "";
const DOT = "";
const PRIVATE = /[-]/g;
const MARKERS = new RegExp(`${OPEN}([^${CLOSE}]*)${CLOSE}`, "g");
/** Abbreviations whose full stop doesn't end a sentence. */
const ABBREV = /\b(e\.g|i\.e|etc|vs|approx|cf|fig|figs|eq|no|dr|prof|st)\./gi;

/** Formatting the screen doesn't render (headings, tables, links, images, HTML, code) taken out, text kept. */
function cleanMarkdown(s: string): string {
  return s
    .replace(PRIVATE, "")
    .replace(/<\/?[a-z][^>]*>/gi, " ")             // HTML tags
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")          // images
    .replace(/\[([^\]]+)\]\((?:[^)]*)\)/g, "$1")    // links: keep the words
    .replace(/https?:\/\/\S+/gi, " ")               // bare links
    .replace(/`+/g, "")                             // code marks
    .replace(/__(.+?)__/g, "**$1**")
    .replace(/(?<![*\w])\*(?!\*)([^*\n]+?)\*(?![*\w])/g, "$1") // *italics*
    .replace(/(?<![\w*])_([^_\n]+?)_(?![\w])/g, "$1");          // _italics_
}

type Line = { list: "ul" | "ol" | null; text: string };

/** Paragraphs and list items of the reply. Headings become plain text; table rows are dropped. */
function blocksOf(raw: string): Line[][] {
  const blocks: Line[][] = [];
  let cur: Line[] = [];
  let para: string[] = [];
  const flushPara = () => { if (para.length) { cur.push({ list: null, text: para.join(" ") }); para = []; } };
  const flushBlock = () => { flushPara(); if (cur.length) blocks.push(cur); cur = []; };
  for (const line of raw.replace(/\r\n?/g, "\n").split("\n")) {
    const t = line.trim();
    if (!t) { flushBlock(); continue; }
    if (/^\|/.test(t) || /^[-:|\s]{3,}$/.test(t)) continue; // tables and rules
    const item = /^(?:([-*•+])|(\d{1,2})[.)])\s+(.*)$/.exec(t);
    if (item) {
      flushPara();
      const kind = item[1] ? "ul" : "ol";
      if (cur.length && cur[cur.length - 1].list !== kind) flushBlock();
      cur.push({ list: kind, text: item[3] });
      continue;
    }
    if (cur.length && cur[cur.length - 1].list) flushBlock();
    para.push(t.replace(/^#{1,6}\s+/, "").replace(/^>\s*/, ""));
  }
  flushBlock();
  return blocks;
}

/** "**a** b **c" → the bold marks only when they pair up. */
function balanceBold(s: string): string {
  const n = s.split("**").length - 1;
  const out = n % 2 ? s.replace(/\*\*/g, "") : s;
  return out.replace(/\*\*\s*\*\*/g, "").replace(/\*{3,}/g, "**");
}

type Sentence = { text: string; chunkIds: string[] };

/**
 * The cited, grounded sentences of one paragraph or list item. A sentence keeps only refs to
 * passages that were sent; with none left, or when its facts aren't in the passages it cites
 * (isGrounded: numbers, terms, formulas, units and most words), it is dropped.
 */
function citedSentences(raw: string, byRef: Map<string, Passage>, drop: () => void): Sentence[] {
  let s = raw.replace(REF_GROUP, (_, g: string) => `${OPEN}${g}${CLOSE}`);
  // "… ATP. [p1] Next" → "… ATP [p1]. Next": a ref after the full stop belongs to that sentence.
  s = s.replace(new RegExp(`([.!?])((?:\\s*${OPEN}[^${CLOSE}]*${CLOSE})+)`, "g"), "$2$1");
  s = s.replace(ABBREV, (m) => m.replace(/\./g, DOT));
  const out: Sentence[] = [];
  for (const sen of sentences(s)) {
    const ids: string[] = [];
    for (const m of sen.matchAll(MARKERS)) {
      for (const r of m[1].split(/\s*(?:,|;|&|and)\s*/i)) {
        const num = /(\d{1,3})/.exec(r)?.[1];
        const p = num ? byRef.get(`p${Number(num)}`) : undefined;
        if (p && !ids.includes(p.chunkId)) ids.push(p.chunkId);
      }
    }
    const plain = collapse(sen.replace(MARKERS, " ").replace(new RegExp(DOT, "g"), ".")).replace(/\s+([.!?,;:])/g, "$1");
    const words = plain.replace(/\*\*/g, "");
    if (!/[\p{L}\p{N}]/u.test(words)) continue; // a stray ref or punctuation on its own
    if (!ids.length) { drop(); continue; }
    const cited = [...byRef.values()].filter((p) => ids.includes(p.chunkId)).map((p) => p.text).join("\n");
    if (!isGrounded(words, cited) || contradictsPassage(words, cited)) { drop(); continue; }
    out.push({ text: balanceBold(plain), chunkIds: ids });
  }
  return out;
}

const wordCount = (s: string) => (s.replace(/\*\*/g, "").match(/[\p{L}\p{N}]+/gu) ?? []).length;

/** Builds the stored text: sentences with their renumbered refs, paragraphs, lists. */
function render(blocks: { list: Line["list"]; sentences: Sentence[] }[][], number: (chunkId: string) => number, maxWords: number): string {
  let words = 0;
  const parts: string[] = [];
  outer: for (const block of blocks) {
    const lines: string[] = [];
    let ord = 0;
    for (const item of block) {
      const said: string[] = [];
      for (const sen of item.sentences) {
        const w = wordCount(sen.text);
        if (words + w > maxWords && words > 0) {
          if (said.length) lines.push(lineOf(item.list, ++ord, said));
          if (lines.length) parts.push(lines.join("\n"));
          break outer;
        }
        words += w;
        said.push(`${sen.text} ${sen.chunkIds.map((id) => `[${number(id)}]`).join("")}`);
      }
      if (said.length) lines.push(lineOf(item.list, ++ord, said));
    }
    if (lines.length) parts.push(lines.join("\n"));
  }
  return parts.join("\n\n");
}
const lineOf = (list: Line["list"], n: number, said: string[]) => `${list === "ul" ? "- " : list === "ol" ? `${n}. ` : ""}${said.join(" ")}`;

/**
 * Validates and cleans the model's reply. Null when the reply isn't usable at all (wrong shape,
 * or a quiz without its answer): the provider fallback gets a go and the student's go is refunded.
 * `not_covered` when the model says the passages don't cover the question or no cited, grounded
 * sentence is left (the go is used: the model ran).
 */
export function normaliseChatReply(json: unknown, passages: Passage[], opts: { quiz?: boolean } = {}): ChatReply | null {
  const parsed = rawChatReply.safeParse(json);
  if (!parsed.success) return null;
  const covered = parsed.data.covered;
  let dropped = 0;
  const drop = () => { dropped++; };
  if (covered === false || (typeof covered === "string" && /^(?:false|no)$/i.test(covered.trim()))) return { kind: "not_covered", dropped };

  const byRef = new Map(passages.map((p) => [p.ref, p]));
  const analyse = (raw: string) => blocksOf(cleanMarkdown(raw)).map((block) =>
    block.map((line) => ({ list: line.list, sentences: citedSentences(line.text, byRef, drop) })).filter((l) => l.sentences.length));
  const answerBlocks = analyse(parsed.data.answer ?? "").filter((b) => b.length);
  const revealBlocks = opts.quiz ? analyse(parsed.data.reveal ?? "").filter((b) => b.length) : [];
  if (!answerBlocks.length) return { kind: "not_covered", dropped };
  if (opts.quiz && !revealBlocks.length) return null;

  // Renumber in order of first use (answer first, then the hidden answer).
  const order: string[] = [];
  const number = (id: string) => {
    if (!order.includes(id)) order.push(id);
    return order.indexOf(id) + 1;
  };
  const content = render(answerBlocks, number, ANSWER_MAX_WORDS);
  const reveal = opts.quiz ? render(revealBlocks, number, 120) : null;
  if (content.length > CHAT_CONTENT_MAX || (reveal && reveal.length > REVEAL_MAX)) return null;

  const sentencesFor = (id: string) => [...answerBlocks, ...revealBlocks].flat().flatMap((l) => l.sentences).filter((s) => s.chunkIds.includes(id)).map((s) => s.text).join(" ");
  const citations = order.map((chunkId, i) => {
    const p = passages.find((x) => x.chunkId === chunkId)!;
    return { n: i + 1, chunkId, quote: clip(bestSentence(p, sentencesFor(chunkId).replace(/\*\*/g, "")), QUOTE_MAX) };
  });
  return { kind: "answer", content, reveal, citations, dropped };
}
