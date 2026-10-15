import type { Metadata } from "next";
import { ReviewSession } from "@/components/review/review-session";
import { sessionOutlook } from "@/server/actions/review";
import { reviewQueue } from "@/server/cards";
import { getRepo } from "@/server/session";

export const metadata: Metadata = { title: "Review" };

/** Every subject's due cards in one session, each card wearing its subject's colours. */
export default async function ReviewAllPage() {
  const repo = await getRepo();
  const [queue, subjects, all] = await Promise.all([reviewQueue(repo, null), repo.listSubjects(), repo.listFlashcards()]);
  const outlook = queue.length === 0 ? await sessionOutlook(null) : null;
  return (
    <ReviewSession
      subject={null} initialQueue={queue} totalCards={all.length}
      subjects={subjects.map((s) => ({ id: s.id, name: s.name, colour: s.colour, emoji: s.emoji }))}
      initialOutlook={outlook?.ok ? outlook.outlook : null}
    />
  );
}
