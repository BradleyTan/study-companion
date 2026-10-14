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
