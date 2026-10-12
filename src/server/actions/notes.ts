"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { chunkPages } from "@/lib/extract/chunk";
import { id as idSchema, noteUpdate } from "@/lib/validation";
import { getRepo } from "../session";
import { firstIssue, type ActionResult } from "./result";

const MAX_NOTES_PER_SUBJECT = 500;

export async function createNote(subjectId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(subjectId).success) return { ok: false, error: "Subject not found." };
  const repo = await getRepo();
  if (!(await repo.getSubject(subjectId))) return { ok: false, error: "Subject not found." };
  if ((await repo.listNotes(subjectId)).length >= MAX_NOTES_PER_SUBJECT) {
    return { ok: false, error: `A subject can hold up to ${MAX_NOTES_PER_SUBJECT} notes.` };
  }
  const { id } = await repo.createNote(subjectId);
  redirect(`/subjects/${subjectId}/notes/${id}`);
}

export async function saveNote(raw: unknown): Promise<ActionResult<{ updatedAt: string }>> {
  const parsed = noteUpdate.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  const note = await repo.getNote(parsed.data.id);
  if (!note) return { ok: false, error: "This note was deleted." };
  const { updatedAt } = await repo.updateNote(parsed.data.id, parsed.data);
  // Keep the searchable passages in step with the note (used by AI features in Steps 2–3).
  const text = [parsed.data.title, parsed.data.contentText].filter(Boolean).join("\n\n");
  await repo.replaceNoteChunks(note.id, note.subjectId, chunkPages([text], { paged: false }));
  revalidatePath(`/subjects/${note.subjectId}`);
  return { ok: true, updatedAt };
}

export async function deleteNote(id: string): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Note not found." };
  const repo = await getRepo();
  const note = await repo.getNote(id);
  if (!note) return { ok: false, error: "Note not found." };
  await repo.deleteNote(id);
  revalidatePath(`/subjects/${note.subjectId}`);
  redirect(`/subjects/${note.subjectId}`);
}
