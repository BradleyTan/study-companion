import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NoteEditor } from "@/components/note-editor";
import { id as idSchema } from "@/lib/validation";
import { getRepo } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/subjects/[id]/notes/[noteId]">): Promise<Metadata> {
  const { noteId } = await params;
  if (!idSchema.safeParse(noteId).success) return {};
  const n = await (await getRepo()).getNote(noteId);
  return { title: n?.title || "Untitled note" };
}

export default async function NotePage({ params }: PageProps<"/subjects/[id]/notes/[noteId]">) {
  const { id, noteId } = await params;
  if (!idSchema.safeParse(id).success || !idSchema.safeParse(noteId).success) notFound();
  const repo = await getRepo();
  const [subject, note] = await Promise.all([repo.getSubject(id), repo.getNote(noteId)]);
  if (!subject || !note || note.subjectId !== subject.id) notFound();
  return <NoteEditor key={note.id} note={note} subject={subject} />;
}
