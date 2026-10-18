import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuizShelf } from "@/components/quiz/quiz-shelf";
import { id as idSchema } from "@/lib/validation";
import { quotaFor } from "@/server/ai";
import { shelf } from "@/server/quiz";
import { getRepo } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/subjects/[id]/quizzes">): Promise<Metadata> {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return {};
  const s = await (await getRepo()).getSubject(id);
  return { title: s ? `${s.name} quizzes` : "Quizzes" };
}

export default async function QuizzesPage({ params, searchParams }: PageProps<"/subjects/[id]/quizzes">) {
  const { id } = await params;
  const { make } = await searchParams;
  if (!idSchema.safeParse(id).success) notFound();
  const repo = await getRepo();
  const subject = await repo.getSubject(id);
  if (!subject) notFound();
  const [data, quota, notes, files] = await Promise.all([shelf(repo, id), quotaFor(repo, "quiz"), repo.listNotes(id), repo.listSources(id)]);
  const hasSources = notes.some((n) => n.chars > 0) || files.some((f) => f.extractStatus === "ready");
  return (
    <QuizShelf
      subject={{ id: subject.id, name: subject.name, colour: subject.colour, emoji: subject.emoji }}
      quizzes={data.quizzes} weak={data.weak} quota={quota} hasSources={hasSources} openMake={make === "1" && hasSources}
    />
  );
}
