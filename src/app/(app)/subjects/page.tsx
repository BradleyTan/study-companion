import type { Metadata } from "next";
import { DueBanner } from "@/components/due-banner";
import { SubjectsGrid } from "@/components/subjects-grid";
import { allDue } from "@/server/cards";
import { getRepo } from "@/server/session";

export const metadata: Metadata = { title: "Your subjects" };

export default async function SubjectsPage() {
  const repo = await getRepo();
  const [subjects, due] = await Promise.all([repo.listSubjects(), allDue(repo)]);
  const dueBySubject = Object.fromEntries(due.bySubject);
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl">Your subjects</h1>
      <DueBanner
        total={due.total} reviewedToday={due.reviewedToday} day={due.day}
        subjects={subjects.filter((s) => dueBySubject[s.id]).map((s) => ({ name: s.name, due: dueBySubject[s.id] }))}
      />
      <SubjectsGrid subjects={subjects} due={dueBySubject} />
    </div>
  );
}
