"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { SUBJECT_COLOURS } from "@/lib/subjects";
import * as copy from "@/lib/timer/copy";
import {
  canAddFive, clock, displaySec, elapsedFraction, focusedSoFar, isActive, PHASE_PREF, PHASES, plannedFor, RANGES, remainingMs, roundDots, type Phase,
} from "@/lib/timer/machine";
import { formatDuration } from "@/lib/timer/tally";
import { useSound } from "../sound-provider";
import { Button } from "../ui/button";
import { useToast } from "../ui/live-toast";
import { DurationStepper } from "./duration-stepper";
import { useTimer, type TimerSubject } from "./timer-provider";
import { TimerRing } from "./timer-ring";

const SHORT: Record<Phase, string> = { focus: "focus", short_break: "short break", long_break: "long break" };

/** The timer itself (timer.md "Layout"): in the panel, and full size on `/timer`. */
export function TimerView({ variant }: { variant: "panel" | "page" }) {
  const t = useTimer();
  const { state, prefs, now, hydrated } = t;
  const { play } = useSound();
  const toast = useToast();
  const [confirmStop, setConfirmStop] = useState(false);
  const endHeading = useRef<HTMLHeadingElement>(null);
  const uid = useId();

  const phase: Phase = state.status === "ended" ? state.ended.phase : state.phase;
  const subject = t.subjectById(t.subjectId);
  const left = displaySec(remainingMs(state, now, prefs));
  const elapsed = elapsedFraction(state, now, prefs);
  const dots = roundDots(state, prefs, now);
  const page = variant === "page";
  const size = page ? 320 : 240;
  const active = isActive(state);
  const paused = state.status === "paused";

  // Stop's inline question goes away when the round ends or is stopped elsewhere.
  const sessionKey = active ? state.sessionId : null;
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setConfirmStop(false), [sessionKey]);

  // The end card's heading takes focus, but only where the timer is what the student is looking at.
  const endedId = state.status === "ended" ? state.ended.sessionId : null;
  const showHere = page || t.panelOpen;
  useEffect(() => {
    if (endedId && showHere) endHeading.current?.focus();
  }, [endedId, showHere]);

  // Space on `/timer` (not on a control or text field): start / pause / resume.
  useEffect(() => {
    if (!page) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest("input, textarea, select, button, a, [contenteditable=''], [contenteditable='true'], [role=button], dialog[open]")) return;
      e.preventDefault();
      if (!hydrated) return;
      play("click");
      if (state.status === "running") t.pauseTimer();
      else if (state.status === "paused") t.resumeTimer();
      else if (state.status === "ended") t.startPhase(state.next);
      else t.startPhase(state.phase);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [page, hydrated, state, t, play]);

  const colour = subject ? SUBJECT_COLOURS[subject.colour] : "var(--highlight)";
  const label = paused ? "Paused" : copy.PHASE_NAME[phase];
  const subjectLabel = subject ? `${subject.emoji} ${subject.name}` : "No subject";
  const stepKey = PHASE_PREF[state.status === "idle" ? state.phase : "focus"];
  const range = RANGES[stepKey];

  const savePref = async (patch: Parameters<typeof t.setPrefs>[0]) => toast.show((await t.setPrefs(patch)) ? "Saved" : "Couldn't save. Try again.");

  let endText: { heading: string; line: string } | null = null;
  if (state.status === "ended") {
    const nextMin = Math.round(plannedFor(state.next, prefs) / 60);
    endText = copy.endCard({ phase: state.ended.phase, next: state.next, nextMin, today: t.tally.rounds, longEvery: prefs.longEvery });
  }

  return (
    <div className={`flex w-full flex-col items-center gap-5 ${page ? "max-w-xl" : ""}`} style={{ ["--subject" as string]: colour }}>
      <div className="field w-full sm:w-[280px]">
        <label htmlFor={`${uid}-subject`}>Studying</label>
        <select
          id={`${uid}-subject`} className="input min-h-11" value={subject?.id ?? ""}
          onChange={(e) => { play("click"); t.chooseSubject(e.target.value || null); }}
        >
          {t.subjects.map((s: TimerSubject) => <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}
          <option value="">No subject</option>
        </select>
        {t.subjects.length === 0 && <Link href="/subjects" className="hint inline-flex min-h-11 w-fit items-center underline underline-offset-4" onClick={() => t.closePanel()}>Make a subject</Link>}
      </div>

      {state.status === "idle" && (
        <fieldset className="flex flex-col items-center gap-1">
          <legend className="sr-only">Timer type</legend>
          <div className="seg flex-wrap justify-center">
            {PHASES.map((p) => (
              <label key={p} className="relative text-sm sm:text-base">
                <input
                  type="radio" name={`${uid}-phase`} className="sr-only" checked={state.phase === p}
                  onChange={() => { play("click"); t.choosePhase(p); }}
                />
                {copy.PHASE_NAME[p]} · {prefs[PHASE_PREF[p]]}
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className={page ? "w-[min(260px,calc(100vw-32px))] sm:w-[320px]" : "w-[min(240px,calc(100vw-32px))]"}>
        <TimerRing size={size} phase={phase} elapsed={elapsed} colour={colour} bump={endedId}>
          <span className="text-base text-ink-soft">{label}</span>
          <span
            role="timer" aria-live="off" aria-atomic="true" data-testid="timer-time"
            aria-label={copy.timerName({ phase, paused, subject: subject?.name ?? null, sec: left, idle: state.status === "idle" })}
            className={`timer-digits ${page ? "timer-digits-lg" : ""}`}
          >
            {clock(left)}
          </span>
          <span className="chip max-w-full truncate" style={subject ? { background: colour, color: "var(--on-colour)" } : undefined}>{subjectLabel}</span>
          <span role="img" aria-label={`Round ${dots.round} of ${dots.total}`} className="mt-1 flex gap-1.5">
            {Array.from({ length: dots.total }, (_, i) => (
              <span key={i} className={`round-dot ${i < dots.filled ? "round-dot-done" : ""}`} />
            ))}
          </span>
        </TimerRing>
      </div>

      {state.status === "ended" && endText ? (
        <div className="sticker pop-in relative flex w-full max-w-md flex-col items-center gap-3 p-5 pt-6 text-center" data-testid="end-card">
          <span className="tape" aria-hidden="true" />
          <h3 ref={endHeading} tabIndex={-1} className="text-xl font-bold">{endText.heading}</h3>
          {state.ended.away && <p>{copy.awayLine(state.ended.phase, state.ended.endedAt, t.timezone)}</p>}
          <p>{endText.line}</p>
          <div className="flex w-full flex-wrap justify-center gap-2">
            {state.ended.phase === "focus" ? (
              <>
                <Button variant="primary" className="w-full sm:w-auto" onClick={() => t.startPhase(state.next)}>Start break</Button>
                <Button variant="ghost" onClick={() => t.endCardChoice("skip_break")}>Skip break</Button>
              </>
            ) : (
              <>
                <Button variant="primary" className="w-full sm:w-auto" onClick={() => t.startPhase("focus")}>Start focus</Button>
                <Button variant="ghost" onClick={() => t.endCardChoice("done")}>Done for now</Button>
              </>
            )}
          </div>
        </div>
      ) : confirmStop && active ? (
        <div className="flex w-full max-w-md flex-col items-center gap-3 text-center" role="group" aria-labelledby={`${uid}-stopq`}>
          <p id={`${uid}-stopq`} className="font-bold">{copy.stopQuestion(focusedSoFar(state, now), subject?.name ?? null)}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => { setConfirmStop(false); t.stopTimer(); }}>End round</Button>
            <Button variant="primary" autoFocus onClick={() => setConfirmStop(false)}>Keep going</Button>
          </div>
        </div>
      ) : (
        <div className="flex w-full flex-wrap items-center justify-center gap-2">
          {state.status === "idle" && (
            <>
              <Button variant="primary" className="w-full sm:w-[220px]" disabled={!hydrated} onClick={() => t.startPhase(state.phase)}>
                {state.phase === "focus" ? "Start focus" : "Start break"}
              </Button>
              <DurationStepper
                ghost value={prefs[stepKey]} min={range.min} max={range.max} step={range.step} unit="min" what={SHORT[state.phase]}
                onChange={(v) => void savePref({ [stepKey]: v })}
              />
            </>
          )}
          {state.status === "running" && (
            <>
              <Button variant="primary" className="min-w-28" onClick={t.pauseTimer}>Pause</Button>
              <Button onClick={t.addFiveMin} disabled={!canAddFive(state)}>+5 min</Button>
              {state.phase === "focus"
                ? <Button onClick={() => setConfirmStop(true)}>Stop</Button>
                : <Button onClick={t.stopTimer}>Skip break</Button>}
            </>
          )}
          {state.status === "paused" && (
            <>
              <Button variant="primary" className="min-w-28" onClick={t.resumeTimer}>Resume</Button>
              {state.phase === "focus"
                ? <Button onClick={() => setConfirmStop(true)}>Stop</Button>
                : <Button onClick={t.stopTimer}>Skip break</Button>}
            </>
          )}
        </div>
      )}

      <TodayTally />
      {t.notify.nudge && <NotificationNudge />}
      {toast.node}
    </div>
  );
}

function TodayTally() {
  const t = useTimer();
  const { tally } = t;
  const shown = Math.min(12, tally.rounds);
  // The new tomato pops in right after a focus round ends.
  const fresh = t.state.status === "ended" && t.state.ended.phase === "focus";
  return (
    <section className="sticker-flat flex w-full max-w-md flex-col gap-2 p-4" aria-labelledby="tally-h" data-testid="today-tally">
      <h3 id="tally-h" className="font-bold">Today</h3>
      {tally.focusSec === 0 ? (
        <p>No rounds yet today. One round is {t.prefs.focusMin} minutes. You&apos;ve got this.</p>
      ) : (
        <>
          {tally.rounds > 0 && (
            <p className="flex flex-wrap items-center gap-0.5 text-xl" role="img" aria-label={`${tally.rounds} ${tally.rounds === 1 ? "tomato" : "tomatoes"}`}>
              {Array.from({ length: shown }, (_, i) => <span key={i} className={fresh && i === shown - 1 ? "tomato-new" : undefined}>🍅</span>)}
              {tally.rounds > 12 && <span className="ml-1 text-base font-bold">+{tally.rounds - 12}</span>}
            </p>
          )}
          <p className="font-bold">{tally.rounds} {tally.rounds === 1 ? "round" : "rounds"} · {formatDuration(tally.focusSec)}</p>
          <ul className="flex flex-col gap-1">
            {tally.bySubject.map((row) => {
              const s = t.subjectById(row.subjectId);
              return (
                <li key={row.subjectId ?? "none"} className="flex gap-2">
                  <span aria-hidden="true">{s?.emoji ?? "⏱️"}</span>
                  <span>{s?.name ?? "No subject"} · {formatDuration(row.sec)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {t.stuck > 0 && (
        <p className="hint">{t.queued === 1 ? "1 round is" : `${t.queued} rounds are`} waiting to be saved. It&apos;ll save when you&apos;re back online.</p>
      )}
    </section>
  );
}

function NotificationNudge() {
  const t = useTimer();
  return (
    <div className="sticker-flat flex w-full max-w-md flex-col gap-3 p-4" data-testid="notify-nudge">
      <p>Want a nudge when time&apos;s up? Your browser will ask first. We only use it for the timer.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={() => void t.notify.setEnabled(true)}>Turn on</Button>
        <Button size="sm" variant="ghost" onClick={t.notify.dismissNudge}>Not now</Button>
      </div>
    </div>
  );
}
