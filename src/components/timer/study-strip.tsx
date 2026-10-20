"use client";
import Link from "next/link";
import { hhmm } from "@/lib/timetable/dates";
import type { NextClass } from "@/server/timetable";
import { useSound } from "../sound-provider";
import { clock } from "@/lib/timer/copy";
import { displaySec, isActive, remainingMs } from "@/lib/timer/machine";
import { formatDuration, weekFocusSec } from "@/lib/timer/tally";
import { Button } from "../ui/button";
import { useTimer } from "./timer-provider";

/**
 * Subject page study strip (subject.md, Step 4): Start focus for this subject, this week's focus
 * time and the next class (or a Study block happening now). `next` undefined: it didn't load, so
 * that part is hidden. The band takes `--subject` from the page root (subject page).
 */
export function StudyStrip({ subjectId, name, next }: { subjectId: string; name: string; next?: NextClass }) {
  const t = useTimer();
  const { play } = useSound();
  const { state } = t;
  const week = t.sessions ? weekFocusSec(t.sessions, subjectId, t.timezone, new Date(t.now)) : null;

  let action: React.ReactNode;
  if (isActive(state) && state.subjectId === subjectId && state.phase === "focus") {
    const time = clock(displaySec(remainingMs(state, t.now, t.prefs)), false);
    action = (
      <Button size="sm" variant="primary" className="timer-chip-focus tabular-nums" aria-label={`Focusing on ${name}, ${time} left. Open the timer`} onClick={t.openPanel}>
        <span aria-hidden="true">🍅</span> {state.status === "paused" ? "Paused" : "Focusing"} · {time}
      </Button>
    );
  } else if (isActive(state) && state.phase === "focus") {
    action = (
      <Button size="sm" onClick={() => { t.chooseSubject(subjectId); t.openPanel(); }}>
        Switch timer to {name}
      </Button>
    );
  } else if (isActive(state)) {
    action = (
      <Button size="sm" className="tabular-nums" onClick={t.openPanel}>
        On a break · {clock(displaySec(remainingMs(state, t.now, t.prefs)), false)}
      </Button>
    );
  } else {
    action = (
      <Button
        size="sm" variant="primary" disabled={!t.hydrated}
        onClick={() => { t.startPhase("focus", { subjectId }); t.openPanel(); }}
      >
        <span aria-hidden="true">🍅</span> Start focus
      </Button>
    );
  }

  return (
    <div className="strip study-strip" data-testid="study-strip">
      <div className="shrink-0">{action}</div>
      {week !== null && (
        <p className="min-w-0">
          {week > 0 ? <>This week: <strong>{formatDuration(week)}</strong> studied</> : "No focus rounds this week yet"}
        </p>
      )}
      {next !== undefined && (
        <p className="min-w-0 sm:ml-auto" data-testid="study-next">
          {next === null ? (
            <Link href={`/timetable?add=1&subject=${subjectId}&kind=class`} className="inline-flex min-h-11 items-center font-bold underline underline-offset-4" onClick={() => play("click")}>Add a class</Link>
          ) : next.kind === "studyNow" ? (
            <>Study block now · until {hhmm(next.untilMin)}</>
          ) : (
            <Link
              href={`/timetable?week=${next.date}`} className="inline-flex min-h-11 items-center underline underline-offset-4" onClick={() => play("click")}
              aria-label={`Next class: ${next.title}, ${next.whenLong}${next.location ? `, ${next.location}` : ""}`}
            >
              <span>Next: <strong>{next.title}</strong>, {next.when}{next.location ? ` · ${next.location}` : ""}</span>
            </Link>
          )}
        </p>
      )}
    </div>
  );
}
