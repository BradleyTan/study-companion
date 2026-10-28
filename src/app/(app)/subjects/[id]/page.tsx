import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewNoteButton } from "@/components/new-note-button";
import { MakeNotesButton, MakeNotesHost } from "@/components/notes/make-notes-dialog";
import { NoteRow } from "@/components/note-row";
import { WeakStrip } from "@/components/quiz/weak-strip";
import { StudyTools } from "@/components/study-tools";
import { StartHere } from "@/components/start-here";
import { SubjectHeader } from "@/components/subject-header";
import { subjectStyle } from "@/components/ui/subject-style";
import { StudyStrip } from "@/components/timer/study-strip";
import { Uploads } from "@/components/uploads";
import { supabaseConfig } from "@/lib/env";
import { id as idSchema } from "@/lib/validation";
import { quotaFor } from "@/server/ai";
import { subjectDue } from "@/server/cards";
import { subjectQuizSummary } from "@/server/quiz";
import { getRepo } from "@/server/session";
import { nextForSubject } from "@/server/timetable";
import { nowMs } from "@/lib/time";

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
  const [notes, sources, due, mindmap, quiz, chat, next] = await Promise.all([
    repo.listNotes(id),
    repo.listSources(id),
    // Counts that fail to load just leave the tile without its sub-line.
    subjectDue(repo, id).catch(() => null),
    repo.getMindmap(id).catch(() => undefined),
    subjectQuizSummary(repo, id).catch(() => null),
    Promise.all([quotaFor(repo, "chat"), repo.countChat(id)]).then(([q, n]) => ({ left: q.left, asked: n > 0 })).catch(() => null),
    // The study strip's "Next" part; a failed read hides just that part.
    Promise.all([repo.listSlots(), repo.getProfile()])
      .then(([slots, p]) => nextForSubject(slots, subject, nowMs(), p.timezone, p.weekStart))
      .catch(() => undefined),
  ]);

  // First run: nothing to study from yet (polish.md P1-1).
  const empty = notes.length === 0 && sources.length === 0;

  return (
    <div className="flex flex-col gap-8" style={subjectStyle(subject.colour)}>
      <SubjectHeader subject={subject} />
      {empty && <StartHere subjectId={id} />}
      <StudyTools empty={empty} subjectId={id} due={due?.total ?? null} cards={due?.cards ?? null} mindmapUpdatedAt={mindmap === undefined ? undefined : mindmap?.createdAt ?? null} quiz={quiz} chat={chat} />
      {quiz && <WeakStrip subjectId={id} count={quiz.weak.count} names={quiz.weak.names} />}
      <StudyStrip subjectId={id} name={subject.name} next={next} />
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section aria-labelledby="notes-h" className="flex min-w-0 flex-col gap-4">
          {/* One dialog for both buttons, so it survives the first note replacing the empty box. */}
          <MakeNotesHost subjectId={id} subjectName={subject.name}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="notes-h" className="text-2xl font-bold">Notes</h2>
            {notes.length > 0 && (
              <div className="flex flex-wrap items-start gap-2">
                <MakeNotesButton subjectId={id} subjectName={subject.name} />
                <NewNoteButton subjectId={id} />
              </div>
            )}
          </div>
          {notes.length === 0 ? (
            <div className="flex flex-col items-start gap-3 rounded-lg border-[2.5px] border-dashed border-ink bg-card/70 p-5">
              <p>No notes yet. Type your first one, or let us make notes from your lecture files or a web page.</p>
              <div className="flex flex-wrap items-start gap-2">
                <NewNoteButton subjectId={id} label="Write a note" />
                <MakeNotesButton subjectId={id} subjectName={subject.name} />
              </div>
            </div>
          ) : (
            <ul className="flex flex-col gap-3" role="list">
              {notes.map((n) => <NoteRow key={n.id} note={n} subjectId={id} subjectName={subject.name} />)}
            </ul>
          )}
          </MakeNotesHost>
        </section>
        <section aria-labelledby="files-h" className="flex min-w-0 flex-col gap-4">
          <h2 id="files-h" className="scroll-mt-4 text-2xl font-bold">Lecture files</h2>
          <Uploads subjectId={id} subjectName={subject.name} sources={sources} supabase={supabaseConfig()} />
        </section>
      </div>
    </div>
  );
}
