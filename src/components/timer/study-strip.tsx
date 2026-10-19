"use client";
import { SUBJECT_COLOURS, type SubjectColour } from "@/lib/subjects";
import { clock } from "@/lib/timer/copy";
import { displaySec, isActive, remainingMs } from "@/lib/timer/machine";
import { formatDuration, weekFocusSec } from "@/lib/timer/tally";
import { Button } from "../ui/button";
import { useTimer } from "./timer-provider";

/**
 * Subject page study strip (subject.md, Step 4): Start focus for this subject and this week's
 * focus time. The "Next class" part arrives with the timetable (Step 4 part 2); until then the
 * strip has two parts.
 */
export function StudyStrip({ subjectId, name, colour }: { subjectId: string; name: string; colour: SubjectColour }) {
  const t = useTimer();
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
    <div className="strip study-strip" style={{ ["--subject" as string]: SUBJECT_COLOURS[colour] }} data-testid="study-strip">
      <div className="shrink-0">{action}</div>
      {week !== null && (
        <p className="min-w-0">
          {week > 0 ? <>This week: <strong>{formatDuration(week)}</strong> studied</> : "No focus rounds this week yet"}
        </p>
      )}
    </div>
  );
}
