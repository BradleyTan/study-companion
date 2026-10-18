import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewNoteButton } from "@/components/new-note-button";
import { NoteRow } from "@/components/note-row";
import { WeakStrip } from "@/components/quiz/weak-strip";
import { StudyTools } from "@/components/study-tools";
import { SubjectHeader } from "@/components/subject-header";
import { Uploads } from "@/components/uploads";
import { supabaseConfig } from "@/lib/env";
import { id as idSchema } from "@/lib/validation";
import { subjectDue } from "@/server/cards";
import { subjectQuizSummary } from "@/server/quiz";
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
  const [notes, sources, due, mindmap, quiz] = await Promise.all([
    repo.listNotes(id),
    repo.listSources(id),
    // Counts that fail to load just leave the tile without its sub-line.
    subjectDue(repo, id).catch(() => null),
    repo.getMindmap(id).catch(() => undefined),
    subjectQuizSummary(repo, id).catch(() => null),
  ]);

  return (
    <div className="flex flex-col gap-8">
      <SubjectHeader subject={subject} />
      <StudyTools subjectId={id} due={due?.total ?? null} cards={due?.cards ?? null} mindmapUpdatedAt={mindmap === undefined ? undefined : mindmap?.createdAt ?? null} quiz={quiz} />
      {quiz && <WeakStrip subjectId={id} count={quiz.weak.count} names={quiz.weak.names} />}
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
              {notes.map((n) => <NoteRow key={n.id} note={n} subjectId={id} subjectName={subject.name} />)}
            </ul>
          )}
        </section>
        <section aria-labelledby="files-h" className="flex min-w-0 flex-col gap-4">
          <h2 id="files-h" className="text-2xl font-bold">Lecture files</h2>
          <Uploads subjectId={id} subjectName={subject.name} sources={sources} supabase={supabaseConfig()} />
        </section>
      </div>
    </div>
  );
}
