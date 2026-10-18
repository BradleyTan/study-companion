import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { QuizSession, type QuizStart } from "@/components/quiz/quiz-session";
import { id as idSchema } from "@/lib/validation";
import { playView, resultsView } from "@/server/quiz";
import { getRepo } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/subjects/[id]/quizzes/[quizId]">): Promise<Metadata> {
  const { quizId } = await params;
  if (!idSchema.safeParse(quizId).success) return {};
  const q = await (await getRepo()).getQuiz(quizId);
  return { title: q && !q.deletedAt ? q.title : "Quiz" };
}

/**
 * Taking a quiz and its results (quiz.md). `?attempt=` shows that attempt (results once it is
 * finished); without it the latest unfinished attempt resumes, or the screen starts a new one.
 * Rendering never creates an attempt: the client asks for one when it arrives.
 */
export default async function QuizPage({ params, searchParams }: PageProps<"/subjects/[id]/quizzes/[quizId]">) {
  const { id, quizId } = await params;
  const sp = await searchParams;
  if (!idSchema.safeParse(id).success || !idSchema.safeParse(quizId).success) notFound();
  const repo = await getRepo();
  const subject = await repo.getSubject(id);
  if (!subject) notFound();
  const quiz = await repo.getQuiz(quizId);
  if (!quiz || quiz.deletedAt || quiz.subjectId !== subject.id) {
    return (
      <div className="sticker relative mx-auto mt-10 flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <span className="tape" aria-hidden="true" />
        <h1 className="font-display text-2xl">This quiz isn&apos;t here any more.</h1>
        <Link href={`/subjects/${subject.id}/quizzes`} className="btn btn-primary">Back to quizzes</Link>
      </div>
    );
  }
  const wanted = typeof sp.attempt === "string" && idSchema.safeParse(sp.attempt).success ? await repo.getAttempt(sp.attempt) : null;
  const attempt = wanted && wanted.quizId === quiz.id ? wanted : (await repo.listAttempts({ quizId: quiz.id })).find((a, i) => i === 0 && !a.finishedAt) ?? null;
  let start: QuizStart = { kind: "start" };
  if (attempt?.finishedAt) start = { kind: "results", results: await resultsView(repo, quiz, attempt) };
  else if (attempt) start = { kind: "play", view: await playView(repo, quiz, attempt) };
  return (
    <QuizSession
      key={attempt?.id ?? "new"}
      subject={{ id: subject.id, name: subject.name, colour: subject.colour, emoji: subject.emoji }}
      quizId={quiz.id} title={quiz.title} start={start}
    />
  );
}
