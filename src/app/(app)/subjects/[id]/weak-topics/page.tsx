import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { WeakTopicsList } from "@/components/quiz/weak-topics-list";
import { id as idSchema } from "@/lib/validation";
import { quotaFor } from "@/server/ai";
import { weakTopicsView } from "@/server/quiz";
import { getRepo } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/subjects/[id]/weak-topics">): Promise<Metadata> {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return {};
  const s = await (await getRepo()).getSubject(id);
  return { title: s ? `${s.name} weak topics` : "Weak topics" };
}

export default async function WeakTopicsPage({ params }: PageProps<"/subjects/[id]/weak-topics">) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const repo = await getRepo();
  const subject = await repo.getSubject(id);
  if (!subject) notFound();
  const [view, quota] = await Promise.all([weakTopicsView(repo, id), quotaFor(repo, "quiz")]);
  return (
    <WeakTopicsList
      subject={{ id: subject.id, name: subject.name, colour: subject.colour, emoji: subject.emoji }}
      open={view.open} gotIt={view.gotIt} hasQuizzes={view.hasQuizzes} hasAttempts={view.hasAttempts} quota={quota}
    />
  );
}
