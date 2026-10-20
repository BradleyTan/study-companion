"use client";
import Link from "next/link";
import { bestScoreCopy } from "@/lib/quiz/copy";
import { timeAgo } from "@/lib/time";
import { useSound } from "./sound-provider";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export type QuizTileInfo = { quizzes: number; best: { score: number; total: number } | null; tries: number; unfinished: { answered: number; total: number } | null };

/** The tile sub-line while the subject has no notes and no files (polish.md P1-1). */
export const ADD_FIRST = "Add a note first";

/**
 * Study tools on the subject page (subject.md, Steps 2–3): the Review tile on its own row, then
 * Flashcards, Mindmap, Quizzes and Ask your notes (2 × 2 on phones, one row of four from 640 px).
 * `empty`: no notes and no files yet, so every tile says "Add a note first" (tiles stay links).
 */
export function StudyTools({ subjectId, due, cards, mindmapUpdatedAt, quiz, chat, empty = false }: {
  subjectId: string;
  due: number | null;
  cards: number | null;
  mindmapUpdatedAt: string | null | undefined;
  /** null: the counts didn't load (the tile shows without its sub-line). */
  quiz: QuizTileInfo | null;
  /** null: the counts didn't load. */
  chat: { left: number; asked: boolean } | null;
  empty?: boolean;
}) {
  const { play } = useSound();
  const minutes = due ? Math.max(1, Math.ceil((due * 20) / 60)) : 0;
  const best = quiz?.best ? bestScoreCopy(quiz.best, quiz.tries) : null;
  const count = quiz ? (quiz.quizzes === 1 ? "1 quiz" : `${quiz.quizzes} quizzes`) : "";
  const cardsLine = empty ? ADD_FIRST : cards === null ? null : cards > 0 ? plural(cards, "card") : "Make your first cards";
  const mapLine = empty ? ADD_FIRST : mindmapUpdatedAt === undefined ? null : mindmapUpdatedAt ? `Updated ${timeAgo(mindmapUpdatedAt)}` : "Not made yet";
  const quizLine = empty ? ADD_FIRST : !quiz ? null
    : quiz.unfinished ? `Finish your quiz · ${quiz.unfinished.answered} of ${quiz.unfinished.total}`
    : quiz.quizzes === 0 ? "Test yourself"
    : quiz.best?.score === 0 ? best!.text
    : [best?.text ?? null, count].filter(Boolean).join(" · ");
  const quizName = empty ? `Quizzes, ${ADD_FIRST.toLowerCase()}` : !quiz ? "Quizzes"
    : quiz.unfinished ? `Quizzes, finish your quiz, ${quiz.unfinished.answered} of ${quiz.unfinished.total}`
    : quiz.quizzes === 0 ? "Quizzes, test yourself"
    : quiz.best?.score === 0 ? `Quizzes, ${best!.label}`
    : `Quizzes${best ? `, ${best.label.replace(/^Best score/, "best")}` : ""}, ${count}`;
  const chatLine = empty ? ADD_FIRST : !chat ? null : chat.asked ? `${plural(chat.left, "question")} left today` : "Ask anything in your notes";
  const name = (tool: string, line: string | null) => (line ? `${tool}, ${line === ADD_FIRST ? line.toLowerCase() : line}` : tool);
  // Neighbours lean opposite ways on the row of four (P3-3).
  const r = (i: number) => ({ ["--r" as string]: i % 2 ? "-1deg" : "1deg" });
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
        <Link href={`/subjects/${subjectId}/flashcards`} className="tile lift" style={r(0)}
          aria-label={name("Flashcards", cardsLine)} onClick={() => play("click")}>
          <span className="flex items-center gap-2 text-lg font-bold"><span aria-hidden="true">🗂️</span>Flashcards</span>
          {cardsLine && <span className="hint">{cardsLine}</span>}
        </Link>
        <Link href={`/subjects/${subjectId}/mindmap`} className="tile lift" style={r(1)}
          aria-label={name("Mindmap", mapLine)} onClick={() => play("click")}>
          <span className="flex items-center gap-2 text-lg font-bold"><span aria-hidden="true">🌳</span>Mindmap</span>
          {mapLine && <span className="hint">{mapLine}</span>}
        </Link>
        <Link href={`/subjects/${subjectId}/quizzes`} className="tile lift" style={r(2)}
          aria-label={quizName} onClick={() => play("click")}>
          <span className="flex items-center gap-2 text-lg font-bold"><span aria-hidden="true">📝</span>Quizzes</span>
          {quizLine && <span className="hint">{quizLine}</span>}
        </Link>
        <Link href={`/subjects/${subjectId}/ask`} className="tile lift" style={r(3)} data-testid="ask-tile"
          aria-label={name("Ask your notes", chatLine)} onClick={() => play("click")}>
          <span className="flex items-center gap-2 text-lg font-bold"><span aria-hidden="true">💬</span>Ask your notes</span>
          {chatLine && <span className="hint">{chatLine}</span>}
        </Link>
      </div>
    </nav>
  );
}
