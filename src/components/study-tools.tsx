"use client";
import Link from "next/link";
import { timeAgo } from "@/lib/time";
import { useSound } from "./sound-provider";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** Study tools row on the subject page (subject.md, Step 2). */
export function StudyTools({ subjectId, due, cards, mindmapUpdatedAt }: { subjectId: string; due: number | null; cards: number | null; mindmapUpdatedAt: string | null | undefined }) {
  const { play } = useSound();
  const minutes = due ? Math.max(1, Math.ceil((due * 20) / 60)) : 0;
  const cardsLine = cards === null ? null : cards > 0 ? plural(cards, "card") : "Make your first cards";
  const mapLine = mindmapUpdatedAt === undefined ? null : mindmapUpdatedAt ? `Updated ${timeAgo(mindmapUpdatedAt)}` : "Not made yet";
  return (
    <nav aria-label="Study tools" className={`grid grid-cols-2 gap-4 ${due ? "sm:grid-cols-[2fr_1fr_1fr]" : ""}`}>
      {!!due && (
        <Link href={`/subjects/${subjectId}/review`} className="tile tile-review lift col-span-2 sm:col-span-1" style={{ ["--r" as string]: "-1deg" }}
          aria-label={`Review, ${due} due, about ${plural(minutes, "minute")}`} onClick={() => play("click")}>
          <span className="text-xl font-bold">Review · {due} due</span>
          <span className="text-sm font-bold opacity-80">About {plural(minutes, "minute")}</span>
        </Link>
      )}
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
    </nav>
  );
}
