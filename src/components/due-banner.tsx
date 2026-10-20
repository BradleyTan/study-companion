"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useSound } from "./sound-provider";
import { Button } from "./ui/button";

/** "12 cards to review today" on the Subjects page (review.md "Due-today counts elsewhere"). */
export function DueBanner({ total, subjects, reviewedToday, day }: { total: number; subjects: { name: string; due: number }[]; reviewedToday: boolean; day: string }) {
  const { play } = useSound();
  const key = `studynest:caughtUpDismissed`;
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    let v: string | null = null;
    try { v = localStorage.getItem(key); } catch {}
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDismissed(v === day);
  }, [day, key]);

  if (total === 0) {
    if (!reviewedToday || dismissed) return null;
    return (
      <div className="flex items-center gap-2 rounded-lg border-2 border-ink bg-card px-3 py-1" role="status">
        <span className="font-bold">All caught up for today ✓</span>
        <Button variant="ghost" size="sm" className="icon-btn ml-auto" aria-label="Dismiss for today" onClick={() => { setDismissed(true); try { localStorage.setItem(key, day); } catch {} }}>✕</Button>
      </div>
    );
  }
  const top = [...subjects].sort((a, b) => b.due - a.due).slice(0, 3);
  const more = subjects.length - top.length;
  return (
    <section aria-labelledby="due-banner-h" className="sticker relative flex flex-col gap-3 p-5 sm:flex-row sm:items-center">
      <span className="tape" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <h2 id="due-banner-h" className="text-xl font-bold"><span aria-hidden="true">📚 </span>{total} {total === 1 ? "card" : "cards"} to review today</h2>
        <p className="text-ink-soft">{top.map((s) => `${s.name} ${s.due}`).join(" · ")}{more > 0 ? ` · +${more} more` : ""}</p>
      </div>
      <Link href="/review" className="btn btn-primary w-full sm:w-auto" onClick={() => play("click")}>Start review</Link>
    </section>
  );
}
