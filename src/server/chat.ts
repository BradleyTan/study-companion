import "server-only";
import { bestSentence, QUOTE_MAX } from "@/lib/ai/schemas";
import { clip } from "@/lib/ai/text";
import type { Passage } from "@/lib/ai/types";
import type { ChatCitationRef } from "@/lib/chat/answer";
import {
  decide, KEYWORD_CANDIDATES, KEYWORD_LOOSE, KEYWORD_MIN, rankByKeywords, SIMILARITY_LOOSE, SIMILARITY_MIN, TOP_K, type Retrieved,
} from "@/lib/chat/retrieve";
import { starterSuggestions } from "@/lib/chat/suggest";
import type { Quota } from "@/lib/limits/ai";
import { sortOpen } from "@/lib/quiz/weak";
import { quotaFor } from "./ai";
import { passageHref } from "./cards";
import { backfillSubjectEmbeddings, embedConfigured, embedQuery } from "./embed";
import type { ChatCitation, ChatFeedback, ChatRow, ChunkRow, NoteSummary, Repo, Source, Subject } from "./repo/types";

// Ask your notes (chat.md): retrieval, citations and what the screen gets.

export const NOT_COVERED = "Your notes don't cover that yet, so I won't guess.";
/** Messages loaded at once (older ones on demand). */
export const CHAT_PAGE = 50;
/** The database stops at 1000 messages per subject; the oldest questions go first, down to this. */
export const CHAT_KEEP = 900;
export const CHAT_CAP = 1000;

/** "keywords": embeddings are missing or the embed function is down (the hint shows). */
export type RetrievalMode = "embeddings" | "keywords";

/** Passages of notes and ready files only (a file being re-read has none worth citing). */
function usable(rows: ChunkRow[], readyFiles: Set<string>): ChunkRow[] {
  return rows.filter((c) => c.noteId || (c.sourceId && readyFiles.has(c.sourceId)));
}

/**
 * The passages a question is answered from: the top 6 of this subject by embedding similarity,
 * or by keyword coverage when embeddings are missing or the embed function is unavailable.
 * Passages that have no embedding yet are searched by keywords alongside (and embedded after the
 * response, for next time). Nothing close enough: no passages, maybe a "Closest I found".
 */
export async function retrieve(repo: Repo, subjectId: string, query: string, readyFiles: Set<string>): Promise<Retrieved<ChunkRow> & { mode: RetrievalMode }> {
  const counts = await repo.embeddingCounts(subjectId);
  if (counts.total > counts.embedded) backfillSubjectEmbeddings(repo.userId, subjectId);
  const embedding = counts.embedded > 0 ? await embedQuery(query) : null;
  const byKeywords = async (unembeddedOnly: boolean) => {
    const found = usable(await repo.searchChunks(subjectId, query, KEYWORD_CANDIDATES, { unembeddedOnly }), readyFiles);
    return decide(rankByKeywords(query, found), KEYWORD_MIN, KEYWORD_LOOSE);
  };
  if (!embedding) return { mode: "keywords", ...(await byKeywords(false)) };

  const near = usable(await repo.matchChunks(subjectId, embedding, TOP_K + 4), readyFiles) as (ChunkRow & { similarity: number })[];
  const byVector = decide(near.map((c) => ({ item: c, score: c.similarity })), SIMILARITY_MIN, SIMILARITY_LOOSE);
  if (counts.embedded >= counts.total) return { mode: "embeddings", ...byVector };
  const rest = await byKeywords(true);
  const uniq = (list: ChunkRow[]) => list.filter((c, i) => list.findIndex((x) => x.id === c.id) === i);
  const passages = uniq([...byVector.passages, ...rest.passages]).slice(0, TOP_K);
  return { mode: "embeddings", passages, closest: passages.length ? [] : uniq([...byVector.closest, ...rest.closest]).slice(0, 2) };
}

/**
 * Passages that mention a short phrase (a weak topic the student added by hand), by the same
 * keyword rules as Ask your notes. Empty when nothing in the notes covers it well enough.
 */
export async function keywordPassages(repo: Repo, subjectId: string, phrase: string, readyFiles: Set<string>): Promise<ChunkRow[]> {
  const found = usable(await repo.searchChunks(subjectId, phrase, KEYWORD_CANDIDATES), readyFiles);
  return decide(rankByKeywords(phrase, found), KEYWORD_MIN, KEYWORD_LOOSE).passages;
}

/** Retrieval mode before anything is asked (for the hint on arrival). */
export async function retrievalMode(repo: Repo, subjectId: string): Promise<RetrievalMode> {
  if (!embedConfigured()) return "keywords";
  const counts = await repo.embeddingCounts(subjectId);
  return counts.embedded > 0 ? "embeddings" : "keywords";
}

/** "Quiz me with one question": a few passages from anywhere in the subject, picked at random. */
export function quizPassages(rows: ChunkRow[], count = 3): ChunkRow[] {
  const pool = rows.filter((c) => c.text.length >= 80);
  const out: ChunkRow[] = [];
  const list = [...(pool.length ? pool : rows)];
  while (out.length < count && list.length) out.push(list.splice(crypto.getRandomValues(new Uint32Array(1))[0] % list.length, 1)[0]);
  return out;
}

type Lookup = { notes: Map<string, NoteSummary>; files: Map<string, Source> };
export const lookupOf = (notes: NoteSummary[], files: Source[]): Lookup => ({ notes: new Map(notes.map((n) => [n.id, n])), files: new Map(files.map((f) => [f.id, f])) });

const unitOf = (f: Source | undefined) => (f?.kind === "pptx" ? "slide" : "page");

/** "Lecture 3.pdf, page 12" / "Cell structure (note)". */
export function citationLabel(chunk: Pick<ChunkRow, "noteId" | "sourceId" | "page">, lookup: Lookup): string {
  if (chunk.noteId) return `${lookup.notes.get(chunk.noteId)?.title || "Untitled note"} (note)`;
  const f = chunk.sourceId ? lookup.files.get(chunk.sourceId) : undefined;
  return `${f?.fileName ?? "Lecture file"}${chunk.page ? `, ${unitOf(f)} ${chunk.page}` : ""}`;
}

/** Stored citations for an answer's renumbered refs, from the student's own passages. */
export function citationsOf(refs: ChatCitationRef[], chunks: ChunkRow[], lookup: Lookup): ChatCitation[] {
  const byId = new Map(chunks.map((c) => [c.id, c]));
  return refs.flatMap((r) => {
    const c = byId.get(r.chunkId);
    return c ? [{ n: r.n, chunkId: c.id, noteId: c.noteId, sourceId: c.sourceId, page: c.page, label: citationLabel(c, lookup), quote: r.quote }] : [];
  });
}

/** "Closest I found" for a not-covered reply: the passage's sentence nearest the question. */
export function closestCitations(chunks: ChunkRow[], question: string, lookup: Lookup): ChatCitation[] {
  return chunks.slice(0, 2).map((c, i) => {
    const p: Passage = { chunkId: c.id, text: c.text, page: c.page, ref: `p${i + 1}` };
    return { n: i + 1, chunkId: c.id, noteId: c.noteId, sourceId: c.sourceId, page: c.page, label: citationLabel(c, lookup), quote: clip(bestSentence(p, question), QUOTE_MAX) };
  });
}

// ---- what the screen gets ------------------------------------------------------------------

export type CitationView = {
  n: number;
  chunkId: string;
  kind: "note" | "file" | "deleted";
  /** Note title or file name (as it is now; the stored label when deleted). */
  title: string;
  page: number | null;
  unit: "page" | "slide";
  /** Accessible name and popover heading: "Lecture 3.pdf, page 12". */
  label: string;
  /** Built with passageHref; null when the note or file was deleted. */
  href: string | null;
  quote: string;
};

export type ChatMessageView = {
  id: string;
  role: "user" | "assistant";
  kind: ChatRow["kind"];
  content: string;
  citations: CitationView[];
  reveal: string | null;
  feedback: ChatFeedback | null;
  createdAt: string;
};

/** Messages as the screen shows them, with live source titles and links (passageHref). */
export async function chatViews(repo: Repo, subjectId: string, rows: ChatRow[], known?: Lookup): Promise<ChatMessageView[]> {
  const cited = rows.flatMap((r) => r.citations);
  let lookup = known;
  if (!lookup && cited.length) {
    const [notes, files] = await Promise.all([repo.listNotes(subjectId), repo.listSources(subjectId)]);
    lookup = lookupOf(notes, files);
  }
  const live = new Set(cited.length ? (await repo.getChunks([...new Set(cited.map((c) => c.chunkId))])).map((c) => c.id) : []);
  return rows.map((r) => ({
    id: r.id, role: r.role, kind: r.kind, content: r.content, reveal: r.reveal, feedback: r.feedback, createdAt: r.createdAt,
    citations: r.citations.map((c): CitationView => {
      const note = c.noteId ? lookup?.notes.get(c.noteId) : undefined;
      const file = c.sourceId ? lookup?.files.get(c.sourceId) : undefined;
      const link = { noteId: note ? c.noteId : null, sourceId: file ? c.sourceId : null, chunkId: live.has(c.chunkId) ? c.chunkId : null };
      const href = note || file ? passageHref(subjectId, link) : null;
      const unit = file?.kind === "pptx" ? "slide" : "page";
      if (note) return { n: c.n, chunkId: c.chunkId, kind: "note", title: note.title || "Untitled note", page: null, unit, label: `${note.title || "Untitled note"} (note)`, href, quote: c.quote };
      if (file) return { n: c.n, chunkId: c.chunkId, kind: "file", title: file.fileName, page: c.page, unit, label: `${file.fileName}${c.page ? `, ${unit} ${c.page}` : ""}`, href, quote: c.quote };
      return { n: c.n, chunkId: c.chunkId, kind: "deleted", title: c.label, page: c.page, unit, label: c.label, href: null, quote: c.quote };
    }),
  }));
}

export type ChatPageData = {
  subject: Pick<Subject, "id" | "name" | "colour" | "emoji">;
  messages: ChatMessageView[];
  hasOlder: boolean;
  quota: Quota;
  /** Make a quiz / Review flashcards on the limit sticker. */
  quizLeft: number;
  dueCards: number;
  mode: RetrievalMode;
  notes: number;
  readyFiles: number;
  /** Files still being read (the "Ask again in a minute" hint). */
  reading: string[];
  suggestions: string[];
};

/** Everything the Ask your notes screen needs on arrival. */
export async function chatPageData(repo: Repo, subject: Subject, extra: { dueCards: number }): Promise<ChatPageData> {
  const [rows, quota, quiz, notes, files, weak, mode] = await Promise.all([
    repo.listChat(subject.id, { limit: CHAT_PAGE + 1 }),
    quotaFor(repo, "chat"),
    quotaFor(repo, "quiz"),
    repo.listNotes(subject.id),
    repo.listSources(subject.id),
    repo.listWeakTopics(subject.id),
    retrievalMode(repo, subject.id),
  ]);
  const writtenNotes = notes.filter((n) => n.chars > 0);
  const ready = files.filter((f) => f.extractStatus === "ready");
  const recent = [...writtenNotes.map((n) => ({ title: n.title, at: n.updatedAt })), ...ready.map((f) => ({ title: f.fileName, at: f.createdAt }))]
    .sort((a, b) => b.at.localeCompare(a.at)).map((x) => x.title);
  const page = rows.slice(0, CHAT_PAGE).reverse();
  return {
    subject: { id: subject.id, name: subject.name, colour: subject.colour, emoji: subject.emoji },
    messages: await chatViews(repo, subject.id, page, lookupOf(notes, files)),
    hasOlder: rows.length > CHAT_PAGE,
    quota,
    quizLeft: quiz.appAllowanceLeft ? quiz.left : 0,
    dueCards: extra.dueCards,
    mode,
    notes: writtenNotes.length,
    readyFiles: ready.length,
    reading: files.filter((f) => f.extractStatus === "pending" || f.extractStatus === "reading").map((f) => f.fileName),
    suggestions: writtenNotes.length || ready.length
      ? starterSuggestions({ weakTopics: sortOpen(weak.filter((w) => !w.clearedAt)).map((w) => w.topic), titles: recent })
      : [],
  };
}
