import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Deck } from "@/components/flashcards/deck";
import { id as idSchema } from "@/lib/validation";
import { quotaFor } from "@/server/ai";
import { dayContext, toDeckCards } from "@/server/cards";
import { getRepo } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/subjects/[id]/flashcards">): Promise<Metadata> {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return {};
  const s = await (await getRepo()).getSubject(id);
  return { title: s ? `${s.name} flashcards` : "Flashcards" };
}

export default async function FlashcardsPage({ params }: PageProps<"/subjects/[id]/flashcards">) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const repo = await getRepo();
  const subject = await repo.getSubject(id);
  if (!subject) notFound();
  const [ctx, cards, quota, notes, files] = await Promise.all([
    dayContext(repo), repo.listFlashcards({ subjectId: id }), quotaFor(repo, "flashcards"), repo.listNotes(id), repo.listSources(id),
  ]);
  const hasSources = notes.length > 0 || files.some((f) => f.extractStatus === "ready");
  return (
    <Deck
      subject={{ id: subject.id, name: subject.name, colour: subject.colour, emoji: subject.emoji }}
      cards={await toDeckCards(repo, cards, ctx)}
      allowanceLeft={ctx.allowanceLeft}
      quota={quota}
      hasSources={hasSources}
      day={{ tz: ctx.tz, end: ctx.dayEnd.toISOString() }}
    />
  );
}
