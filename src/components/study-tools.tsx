"use client";
import Link from "next/link";
import { timeAgo } from "@/lib/time";
import { useSound } from "./sound-provider";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export type QuizTileInfo = { quizzes: number; best: { score: number; total: number } | null; unfinished: { answered: number; total: number } | null };

/**
 * Study tools on the subject page (subject.md, Steps 2–3): the Review tile on its own row, then
 * Flashcards, Mindmap, Quizzes and Ask your notes (2 × 2 on phones, one row of four from 640 px).
 * Ask your notes is part 2 of Step 3: until then its tile is shown disabled ("Coming soon").
 */
export function StudyTools({ subjectId, due, cards, mindmapUpdatedAt, quiz }: {
  subjectId: string;
  due: number | null;
  cards: number | null;
  mindmapUpdatedAt: string | null | undefined;
  /** null: the counts didn't load (the tile shows without its sub-line). */
  quiz: QuizTileInfo | null;
}) {
  const { play } = useSound();
  const minutes = due ? Math.max(1, Math.ceil((due * 20) / 60)) : 0;
  const cardsLine = cards === null ? null : cards > 0 ? plural(cards, "card") : "Make your first cards";
  const mapLine = mindmapUpdatedAt === undefined ? null : mindmapUpdatedAt ? `Updated ${timeAgo(mindmapUpdatedAt)}` : "Not made yet";
  const quizLine = !quiz ? null
    : quiz.unfinished ? `Finish your quiz · ${quiz.unfinished.answered} of ${quiz.unfinished.total}`
    : quiz.quizzes === 0 ? "Test yourself"
    : [quiz.best ? `Best ${quiz.best.score}/${quiz.best.total}` : null, quiz.quizzes === 1 ? "1 quiz" : `${quiz.quizzes} quizzes`].filter(Boolean).join(" · ");
  const quizName = !quiz ? "Quizzes"
    : quiz.unfinished ? `Quizzes, finish your quiz, ${quiz.unfinished.answered} of ${quiz.unfinished.total}`
    : quiz.quizzes === 0 ? "Quizzes, test yourself"
    : `Quizzes${quiz.best ? `, best ${quiz.best.score} out of ${quiz.best.total}` : ""}, ${quiz.quizzes === 1 ? "1 quiz" : `${quiz.quizzes} quizzes`}`;
  return (
    <nav aria-label="Study tools" className="flex flex-col gap-4">
      {!!due && (
        <Link href={`/subjects/${subjectId}/review`} className="tile tile-review lift" style={{ ["--r" as string]: "-1deg" }}
          aria-label={`Review, ${due} due, about ${plural(minutes, "minute")}`} onClick={() => play("click")}>
          <span className="text-xl font-bold">Review · {due} due</span>
          <span className="text-sm font-bold opacity-80">About {plural(minutes, "minute")}</span>
        </Link>
      )}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Link href={`/subjects/${subjectId}/flashcards`} className="tile lift" style={{ ["--r" as string]: "1deg" }}
          aria-label={`Flashcards${cardsLine ? `, ${cardsLine}` : ""}`} onClick={() => play("click")}>
          <span className="flex items-center gap-2 text-lg font-bold"><span aria-hidden="true">🗂️</span>Flashcards</span>
          {cardsLine && <span className="hint">{cardsLine}</span>}
        </Link>
        <Link href={`/subjects/${subjectId}/mindmap`} className="tile lift" style={{ ["--r" as string]: "-1deg" }}
          aria-label={`Mindmap${mapLine ? `, ${mapLine}` : ""}`} onClick={() => play("click")}>
          <span className="flex items-center gap-2 text-lg font-bold"><span aria-hidden="true">🌳</span>Mindmap</span>
          {mapLine && <span className="hint">{mapLine}</span>}
        </Link>
        <Link href={`/subjects/${subjectId}/quizzes`} className="tile lift" style={{ ["--r" as string]: "-1deg" }}
          aria-label={quizName} onClick={() => play("click")}>
          <span className="flex items-center gap-2 text-lg font-bold"><span aria-hidden="true">📝</span>Quizzes</span>
          {quizLine && <span className="hint">{quizLine}</span>}
        </Link>
        <div className="tile opacity-70" style={{ ["--r" as string]: "1deg" }} data-testid="ask-tile">
          <span className="flex items-center gap-2 text-lg font-bold"><span aria-hidden="true">💬</span>Ask your notes</span>
          <span className="hint">Coming soon</span>
        </div>
      </div>
    </nav>
  );
}
