import "server-only";
import { chunkPages } from "@/lib/extract/chunk";
import { passageHref } from "./cards";
import type { ChunkRow, Note, Repo } from "./repo/types";

/** A note's passages come from its title and text (same as the autosave). */
export async function syncNoteChunks(repo: Repo, note: Pick<Note, "id" | "subjectId" | "title" | "contentText">): Promise<void> {
  const text = [note.title, note.contentText].filter(Boolean).join("\n\n");
  await repo.replaceNoteChunks(note.id, note.subjectId, chunkPages([text], { paged: false }));
}

export type PassageView = {
  chunkId: string;
  text: string;
  kind: "note" | "file";
  title: string;
  page: number | null;
  href: string;
};

/** A passage plus where it lives, for the mindmap panel. Null when it's gone or not the student's. */
export async function passageView(repo: Repo, chunk: ChunkRow): Promise<PassageView | null> {
  const href = passageHref(chunk.subjectId, { noteId: chunk.noteId, sourceId: chunk.sourceId, chunkId: chunk.id });
  if (!href) return null;
  if (chunk.noteId) {
    const note = await repo.getNote(chunk.noteId);
    if (!note) return null;
    return { chunkId: chunk.id, text: chunk.text, kind: "note", title: note.title || "Untitled note", page: null, href };
  }
  const src = await repo.getSource(chunk.sourceId!);
  if (!src) return null;
  return { chunkId: chunk.id, text: chunk.text, kind: "file", title: src.fileName, page: chunk.page, href };
}

/** What to mark on a note or source page: the card's quote and/or the passage text. */
export type PassageTarget = { text: string | null; quote: string | null; page: number | null };

/**
 * Resolves `?quote=<chunkId>` or `?card=<flashcardId>` for a note or file page. The chunk or
 * card must belong to the student (the repo only returns their rows) and to this note or file.
 */
export async function passageTarget(
  repo: Repo,
  where: { noteId: string } | { sourceId: string },
  params: { quote?: string | string[]; card?: string | string[] },
): Promise<PassageTarget | null> {
  const one = (v: string | string[] | undefined) => (typeof v === "string" && UUID.test(v) ? v : null);
  const belongs = (x: { noteId: string | null; sourceId: string | null }) =>
    "noteId" in where ? x.noteId === where.noteId : x.sourceId === where.sourceId;
  const quoteId = one(params.quote);
  if (quoteId) {
    const [chunk] = await repo.getChunks([quoteId]);
    return chunk && belongs(chunk) ? { text: chunk.text, quote: null, page: chunk.page } : null;
  }
  const cardId = one(params.card);
  if (cardId) {
    const card = await repo.getFlashcard(cardId);
    if (!card || !belongs(card)) return null;
    const [chunk] = card.chunkId ? await repo.getChunks([card.chunkId]) : [];
    return { text: chunk?.text ?? null, quote: card.sourceQuote, page: chunk?.page ?? card.page };
  }
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
