"use client";
import { useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Quota } from "@/lib/limits/ai";
import { recentText } from "@/lib/quiz/weak";
import { SUBJECT_COLOURS } from "@/lib/subjects";
import { markGotIt, reopenTopic, topicQuestions, type MissedQuestion } from "@/server/actions/weak-topics";
import type { SubjectLite } from "@/server/cards";
import type { TopicView } from "@/server/quiz";
import { Confetti } from "../review/confetti";
import { useSound } from "../sound-provider";
import { SubjectChip } from "../subject-chip";
import { useActionToast } from "../ui/action-toast";
import { Button } from "../ui/button";
import { QuotaChip } from "../ui/quota-chip";
import { RowMenu } from "../ui/row-menu";
import { subjectStyle } from "../ui/subject-style";
import { MakeQuizDialog, type QuizPreset } from "./make-quiz-dialog";

function dayText(iso: string | null, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (d.toDateString() === now.toDateString()) return "today";
  const days = Math.round((now.getTime() - d.getTime()) / 86_400_000);
  if (days < 7) return `on ${d.toLocaleDateString("en", { weekday: "long" })}`;
  return `on ${d.toLocaleDateString("en", { day: "numeric", month: "short" })}`;
}

/** Weak topics (weak-topics.md): a friendly to-practise list, never a report card. */
export function WeakTopicsList({ subject, open: initialOpen, gotIt: initialGot, hasQuizzes, hasAttempts, quota }: {
  subject: SubjectLite;
  open: TopicView[];
  gotIt: TopicView[];
  hasQuizzes: boolean;
  hasAttempts: boolean;
  quota: Quota;
}) {
  const [open, setOpen] = useState(initialOpen);
  const [gotIt, setGotIt] = useState(initialGot);
  /** null: open by default only when everything is cleared. */
  const [showGotPick, setShowGot] = useState<boolean | null>(null);
  const [make, setMake] = useState<QuizPreset | null>(null);
  const [allClearParty, setAllClearParty] = useState(false);
  const practiseAllRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const reduced = useReducedMotion();
  const { play, focusMode } = useSound();
  const calm = !!reduced || focusMode;
  const toast = useActionToast();

  // "All clear!" celebrates once per subject, on the first visit after the last topic clears.
  useEffect(() => {
    if (initialOpen.length || !initialGot.length) return;
    const key = `studynest:allClear:${subject.id}:${initialGot[0].clearedAt}`;
    try {
      if (localStorage.getItem(key)) return;
      localStorage.setItem(key, "1");
    } catch { return; }
    play("cheer");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAllClearParty(true);
  }, [initialOpen.length, initialGot, subject.id, play]);

  async function gotItNow(t: TopicView, index: number) {
    setOpen((l) => l.filter((x) => x.id !== t.id));
    const r = await markGotIt(t.id).catch(() => null);
    if (!r || !r.ok) {
      setOpen((l) => [...l.slice(0, index), t, ...l.slice(index)]);
      play("boop");
      toast.show("Couldn't save that. Try again.");
      return;
    }
    play("pop");
    const cleared = { ...t, clearedAt: r.clearedAt };
    setGotIt((l) => [cleared, ...l.filter((x) => x.id !== t.id)]);
    toast.show("Nice! Moved to Got it.", {
      label: "Undo",
      onClick: async () => {
        const u = await reopenTopic(t.id);
        if (!u.ok) return;
        setGotIt((l) => l.filter((x) => x.id !== t.id));
        setOpen((l) => [...l.slice(0, index), t, ...l.slice(index)]);
      },
    });
    requestAnimationFrame(() => {
      const next = listRef.current?.querySelectorAll<HTMLElement>("[data-practise]")[index];
      (next ?? practiseAllRef.current)?.focus();
    });
  }

  const header = (
    <header className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/subjects/${subject.id}`} className="inline-flex min-h-11 items-center font-bold underline-offset-4 hover:underline" onClick={() => play("click")}>← {subject.name}</Link>
        <SubjectChip name={subject.name} emoji={subject.emoji} colour={subject.colour} />
      </div>
      <h1 className="font-display text-4xl">Weak topics</h1>
      <p className="text-ink-soft">Things to look at again. Answer each one right twice and it&apos;s cleared.</p>
    </header>
  );

  const empty = open.length === 0;
  const showGot = showGotPick ?? empty;
  return (
    <div className="flex flex-col gap-6" style={subjectStyle(subject.colour)}>
      {header}
      {allClearParty && !calm && <Confetti colours={[SUBJECT_COLOURS[subject.colour], "var(--highlight)"]} />}

      {!empty && (
        <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-center">
          <Button ref={practiseAllRef} variant="primary" className="w-full sm:w-auto" onClick={() => setMake({ type: "weak" })} aria-describedby="weak-quota">
            Practise all · {open.length} {open.length === 1 ? "topic" : "topics"}
          </Button>
          <QuotaChip quota={quota} id="weak-quota" />
        </div>
      )}

      {empty && (
        <div className="sticker relative mx-auto mt-2 flex max-w-lg flex-col items-center gap-3 p-8 text-center">
          <span className="tape" aria-hidden="true" />
          {gotIt.length > 0 ? (
            <>
              {calm && allClearParty && <span aria-hidden="true" className="text-5xl">⭐</span>}
              <p className="font-display text-3xl">All clear! <span role="img" aria-label="party">🎉</span></p>
              <p className="text-ink-soft">You&apos;ve got every topic you missed. Try a new quiz to keep it that way.</p>
              <Link href={`/subjects/${subject.id}/quizzes?make=1`} className="btn btn-primary" onClick={() => play("click")}>Make a quiz</Link>
            </>
          ) : (
            <>
              <p className="font-display text-3xl">Nothing tricky yet</p>
              <p className="text-ink-soft">Take a quiz and we&apos;ll keep a list of anything you miss, so you know what to practise.</p>
              {hasQuizzes && !hasAttempts ? (
                <Link href={`/subjects/${subject.id}/quizzes`} className="btn btn-primary" onClick={() => play("click")}>Go to quizzes</Link>
              ) : (
                <Link href={`/subjects/${subject.id}/quizzes?make=1`} className="btn btn-primary" onClick={() => play("click")}>Make a quiz</Link>
              )}
            </>
          )}
        </div>
      )}

      {!empty && (
        <ul ref={listRef} className="mx-auto grid w-full max-w-[760px] grid-cols-1 gap-5 min-[900px]:max-w-[1100px] min-[900px]:grid-cols-2" aria-label="Open weak topics">
          {open.map((t, i) => (
            <li key={t.id}>
              <TopicNote topic={t} rotate={i % 2 ? 0.5 : -0.5} onPractise={() => setMake({ type: "weak", topics: [t.topic] })} onGotIt={() => void gotItNow(t, i)} />
            </li>
          ))}
        </ul>
      )}

      {gotIt.length > 0 && (
        <section className="mx-auto flex w-full max-w-[760px] flex-col gap-3">
          <button type="button" className="btn w-fit" aria-expanded={showGot} aria-controls="got-it" onClick={() => { play("click"); setShowGot(!showGot); }}>
            Got it now ({gotIt.length})
          </button>
          {showGot && (
            <ul id="got-it" className="flex flex-col gap-2">
              {gotIt.map((t) => (
                <li key={t.id} className="sticker-flat flex flex-wrap items-center gap-3 p-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-bold">{t.topic}</span>
                    <span className="hint">Cleared {dayText(t.clearedAt).replace(/^on /, "")}</span>
                  </span>
                  <Button size="sm" variant="ghost" aria-label={`Practise ${t.topic} again`} onClick={() => setMake({ type: "weak", topics: [t.topic] })}>Practise again</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {make && (
        <MakeQuizDialog subjectId={subject.id} subjectName={subject.name} open onClose={() => setMake(null)} preset={make} />
      )}
      {toast.node}
    </div>
  );
}

function TopicNote({ topic: t, rotate, onPractise, onGotIt }: { topic: TopicView; rotate: number; onPractise: () => void; onGotIt: () => void }) {
  const [moreSources, setMoreSources] = useState(false);
  const [questions, setQuestions] = useState<MissedQuestion[] | null>(null);
  const [showQs, setShowQs] = useState(false);
  const { play } = useSound();
  const headingId = `topic-${t.id}`;
  const sources = moreSources ? t.sources : t.sources.slice(0, 2);
  const missed = t.missCount === 1 ? "Missed once" : `Missed ${t.missCount} times`;
  const last = t.lastMissedAt ? ` · last ${dayText(t.lastMissedAt)}` : "";
  async function loadQuestions() {
    setShowQs(true);
    if (questions) return;
    const r = await topicQuestions(t.id).catch(() => null);
    setQuestions(r && r.ok ? r.questions : []);
  }
  return (
    <article aria-labelledby={headingId} className="topic-note flex flex-col gap-2 p-4" style={{ ["--r" as string]: `${rotate}deg` }}>
      <h2 id={headingId} className="text-lg font-bold">{t.topic}</h2>
      <p className="text-sm text-ink-soft">{missed}{last}</p>
      {t.recent.length > 0 && (
        <div role="img" aria-label={recentText(t.recent)} className="flex gap-1.5">
          {t.recent.map((r, i) => <span key={i} className={`try-dot ${r ? "try-right" : "try-miss"}`} aria-hidden="true">{r ? "✓" : "✗"}</span>)}
        </div>
      )}
      {t.rightStreak === 1 && <span className="chip chip-due w-fit">Getting stronger · 1 more right to clear it</span>}
      {t.sources.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm">
          {sources.map((s) => (
            <li key={s.key}>
              {s.kind === "deleted" ? <span className="chip">Source deleted</span> : (
                <span>From <Link href={s.href} className="inline-flex min-h-11 items-center font-bold underline underline-offset-2" onClick={() => play("click")}>{s.title}</Link>{s.kind === "file" && s.page ? `, page ${s.page}` : ""}</span>
              )}
            </li>
          ))}
          {t.sources.length > 2 && !moreSources && (
            <li><button type="button" className="min-h-11 font-bold underline underline-offset-2" onClick={() => { play("click"); setMoreSources(true); }}>+{t.sources.length - 2} more</button></li>
          )}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" data-practise aria-label={`Practise ${t.topic}`} onClick={onPractise}>Practise</Button>
        <RowMenu label={`More actions for ${t.topic}`} items={[
          { label: "Mark as got it", onSelect: onGotIt },
          { label: showQs ? "Hide the questions" : "See the questions", onSelect: () => (showQs ? setShowQs(false) : void loadQuestions()) },
        ]} />
      </div>
      {showQs && (
        <div className="flex flex-col gap-2 border-t-2 border-dashed border-[var(--rule)] pt-2" aria-live="polite">
          {questions === null ? <p className="hint">Loading…</p> : questions.length === 0 ? <p className="hint">No missed questions to show.</p> : (
            <ul className="flex flex-col gap-2 text-sm">
              {questions.map((q) => (
                <li key={q.id}>
                  <p className="font-bold">{q.prompt}</p>
                  <p>Right answer: <strong>{q.answer}</strong></p>
                  {q.explanation && <p className="text-ink-soft">{q.explanation}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </article>
  );
}

