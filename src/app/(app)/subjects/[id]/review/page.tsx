import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewSession } from "@/components/review/review-session";
import { id as idSchema } from "@/lib/validation";
import { sessionOutlook } from "@/server/actions/review";
import { reviewQueue } from "@/server/cards";
import { getRepo } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/subjects/[id]/review">): Promise<Metadata> {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return {};
  const s = await (await getRepo()).getSubject(id);
  return { title: s ? `Review ${s.name}` : "Review" };
}

export default async function SubjectReviewPage({ params }: PageProps<"/subjects/[id]/review">) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const repo = await getRepo();
  const subject = await repo.getSubject(id);
  if (!subject) notFound();
  const [queue, all] = await Promise.all([reviewQueue(repo, id), repo.listFlashcards({ subjectId: id })]);
  const outlook = queue.length === 0 ? await sessionOutlook(id) : null;
  const lite = { id: subject.id, name: subject.name, colour: subject.colour, emoji: subject.emoji };
  return (
    <ReviewSession
      subject={lite} subjects={[lite]} initialQueue={queue} totalCards={all.length}
      initialOutlook={outlook?.ok ? outlook.outlook : null}
    />
  );
}
