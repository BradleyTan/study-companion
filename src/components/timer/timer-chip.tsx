"use client";
import { usePathname } from "next/navigation";
import { SUBJECT_COLOURS } from "@/lib/subjects";
import { chipName, clock } from "@/lib/timer/copy";
import { elapsedFraction } from "@/lib/timer/machine";
import { useSound } from "../sound-provider";
import { chipView, useTimer } from "./timer-provider";

/**
 * Header chip (timer.md "Timer chip"): the only way the timer shows up uninvited. Opens the panel
 * (on `/timer` it jumps to the timer instead).
 */
export function TimerChip() {
  const { hydrated, state, now, prefs, subjectById, chipRef, panelOpen, openPanel, closePanel } = useTimer();
  const { play } = useSound();
  const pathname = usePathname();
  const name = (id: string | null) => subjectById(id)?.name ?? null;
  const view = hydrated ? chipView(state, now, prefs, name) : ({ kind: "idle" } as const);
  const subj = state.status === "running" || state.status === "paused" ? subjectById(state.subjectId) : null;
  const elapsed = elapsedFraction(state, now, prefs);

  let cls = "timer-chip";
  let style: React.CSSProperties | undefined;
  let body: React.ReactNode;
  if (view.kind === "idle") {
    body = (
      <>
        <ClockIcon />
        <span>Timer</span>
      </>
    );
  } else if (view.kind === "ended") {
    cls += " timer-chip-ended pop-in";
    body = <span>{view.phase === "focus" ? "Round done!" : "Break's over"}</span>;
  } else if (view.kind === "paused") {
    cls += " timer-chip-paused";
    body = (
      <>
        <PauseIcon />
        <span className="tabular-nums">{clock(view.sec, false)}</span>
      </>
    );
  } else if (view.phase === "focus") {
    cls += " timer-chip-focus";
    style = { background: subj ? SUBJECT_COLOURS[subj.colour] : "var(--highlight)" };
    body = (
      <>
        <MiniRing elapsed={elapsed} drain />
        <span className="tabular-nums">{clock(view.sec, false)}</span>
      </>
    );
  } else {
    cls += " timer-chip-break";
    body = (
      <>
        <MiniRing elapsed={elapsed} />
        <span className="hidden sm:inline">Break</span>
        <span className="tabular-nums">{clock(view.sec, false)}</span>
      </>
    );
  }

  return (
    <button
      ref={chipRef}
      type="button"
      className={cls}
      style={style}
      aria-label={chipName(view)}
      aria-expanded={pathname === "/timer" ? undefined : panelOpen}
      aria-controls="timer-panel"
      data-testid="timer-chip"
      onClick={() => {
        play("click");
        if (pathname === "/timer") {
          document.getElementById("timer-page-title")?.focus();
          return;
        }
        if (panelOpen) closePanel();
        else openPanel();
      }}
    >
      {body}
    </button>
  );
}

function ClockIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <circle cx="10" cy="11" r="7" />
      <path d="M10 7.5V11l2.5 1.5M8 2.5h4" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <rect x="3" y="2.5" width="3.5" height="11" rx="1" />
      <rect x="9.5" y="2.5" width="3.5" height="11" rx="1" />
    </svg>
  );
}

/** 20 px ring: drains for focus, fills for a break (same as the big ring). */
function MiniRing({ elapsed, drain = false }: { elapsed: number; drain?: boolean }) {
  const r = 7;
  const c = 2 * Math.PI * r;
  const shown = drain ? 1 - elapsed : elapsed;
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20">
      <g transform="rotate(-90 10 10)">
        <circle cx="10" cy="10" r={r} fill="var(--card)" stroke="currentColor" strokeWidth="1.5" />
        <circle
          cx="10" cy="10" r={r - 2} fill="none" stroke="currentColor" strokeWidth="4"
          strokeDasharray={`${(shown * 2 * Math.PI * (r - 2)).toFixed(2)} ${c.toFixed(2)}`}
          strokeDashoffset={drain ? -(elapsed * 2 * Math.PI * (r - 2)) : 0}
        />
      </g>
    </svg>
  );
}
