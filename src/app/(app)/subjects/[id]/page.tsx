import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NewNoteButton } from "@/components/new-note-button";
import { SubjectHeader } from "@/components/subject-header";
import { Uploads } from "@/components/uploads";
import { supabaseConfig } from "@/lib/env";
import { timeAgo } from "@/lib/time";
import { id as idSchema } from "@/lib/validation";
import { getRepo } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/subjects/[id]">): Promise<Metadata> {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return {};
  const s = await (await getRepo()).getSubject(id);
  return { title: s?.name ?? "Subject" };
}

export default async function SubjectPage({ params }: PageProps<"/subjects/[id]">) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const repo = await getRepo();
  const subject = await repo.getSubject(id);
  if (!subject) notFound();
  const [notes, sources] = await Promise.all([repo.listNotes(id), repo.listSources(id)]);

  return (
    <div className="flex flex-col gap-8">
      <SubjectHeader subject={subject} />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section aria-labelledby="notes-h" className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="notes-h" className="text-2xl font-bold">Notes</h2>
            {notes.length > 0 && <NewNoteButton subjectId={id} />}
          </div>
          {notes.length === 0 ? (
            <div className="sticker-flat flex flex-col items-start gap-3 p-5">
              <p>No notes yet. Type your first one.</p>
              <NewNoteButton subjectId={id} label="Write a note" />
            </div>
          ) : (
            <ul className="flex flex-col gap-3" role="list">
              {notes.map((n) => (
                <li key={n.id}>
                  <Link href={`/subjects/${id}/notes/${n.id}`} className="sticker lift block p-4">
                    <span className="block truncate text-lg font-bold">{n.title || "Untitled note"}</span>
                    {n.preview && <span className="block truncate text-ink-soft">{n.preview}</span>}
                    <span className="hint">Edited {timeAgo(n.updatedAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="files-h" className="flex min-w-0 flex-col gap-4">
          <h2 id="files-h" className="text-2xl font-bold">Lecture files</h2>
          <Uploads subjectId={id} sources={sources} supabase={supabaseConfig()} />
        </section>
      </div>
    </div>
  );
}
