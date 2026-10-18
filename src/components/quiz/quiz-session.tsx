"use client";
import { motion, useAnimationControls, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { BLANK, CORRECT_HEADINGS, celebrates, nextHeading, WRONG_HEADINGS } from "@/lib/quiz/order";
import { attemptResults, checkAnswer, overrideAnswer, reportQuestion, startAttempt } from "@/server/actions/quiz";
import type { SubjectLite } from "@/server/cards";
import type { Feedback, PlayQuestion, PlayView, ResultsView } from "@/server/quiz";
import { SourceQuote } from "../flashcards/source-quote";
import { ReadAloudButton } from "../read-aloud/read-aloud-button";
import { speech } from "../read-aloud/speech";
import { useSound } from "../sound-provider";
import { SubjectChip } from "../subject-chip";
import { useActionToast } from "../ui/action-toast";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { subjectStyle } from "../ui/subject-style";
import { QuizResults } from "./quiz-results";

export type QuizStart = { kind: "play"; view: PlayView } | { kind: "results"; results: ResultsView } | { kind: "start" };

const LETTERS = ["A", "B", "C", "D"] as const;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REPORTS = [
  { reason: "wrong_answer", label: "The answer is wrong" },
  { reason: "unclear", label: "The question is unclear" },
  { reason: "not_in_notes", label: "Not in my notes" },
] as const;

/** Prompt with the blank as an inline gap (screen readers hear "blank"). */
function BlankPrompt({ prompt, typed }: { prompt: string; typed?: string }) {
  const at = prompt.indexOf(BLANK);
  if (at < 0) return <>{prompt}</>;
  return (
    <>
      {prompt.slice(0, at)}
      <span className="blank-gap"><span aria-hidden="true">{typed || " "}</span><span className="sr-only">blank</span></span>
      {prompt.slice(at + BLANK.length)}
    </>
  );
}

/** 10 paper bits from the right option (600 ms). Decorative. */
function Burst({ colours }: { colours: string[] }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute left-1/2 top-1/2">
      {Array.from({ length: 10 }, (_, i) => {
        const a = (i / 10) * Math.PI * 2;
        return (
          <motion.span
            key={i} className="absolute h-2 w-2 border border-[var(--ink)]" style={{ background: colours[i % colours.length] }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0 }}
            animate={{ x: Math.cos(a) * 70, y: Math.sin(a) * 40, opacity: 0, rotate: 180 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
          />
        );
      })}
    </span>
  );
}

/**
 * Taking a quiz (quiz.md): one question at a time, Check → feedback with the source quote →
 * Next, then the results. Answers come from the server only after each check.
 */
export function QuizSession({ subject, quizId, title, start }: { subject: SubjectLite; quizId: string; title: string; start: QuizStart }) {
  const [view, setView] = useState<PlayView | null>(start.kind === "play" ? start.view : null);
  const [results, setResults] = useState<ResultsView | null>(start.kind === "results" ? start.results : null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [currentId, setCurrentId] = useState<string | null>(() => (start.kind === "play" ? firstOpen(start.view) : null));
  const [choice, setChoice] = useState<number | null>(null);
  const [text, setText] = useState("");
  const [checking, setChecking] = useState(false);
  const [net, setNet] = useState<"ok" | "retrying" | "offline">("ok");
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [heading, setHeading] = useState<string | null>(null);
  const [streak, setStreak] = useState(0);
  const [burstKey, setBurstKey] = useState(0);
  const [ended, setEnded] = useState(false);
  const [help, setHelp] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const promptRef = useRef<HTMLHeadingElement>(null);
  const feedbackRef = useRef<HTMLHeadingElement>(null);
  const keys = useRef(new Map<string, string>());
  const shake = useAnimationControls();
  const reduced = useReducedMotion();
  const { play, focusMode } = useSound();
  const calm = !!reduced || focusMode;
  const toast = useActionToast();
  const uid = useId();
  const owner = `quiz:${quizId}`;

  const q = view?.questions.find((x) => x.id === currentId) ?? null;
  const fb = q && view ? view.feedback[q.id] ?? null : null;
  const index = q && view ? view.questions.findIndex((x) => x.id === q.id) : -1;
  const total = view?.questions.length ?? 0;
  const answered = view ? view.questions.filter((x) => view.feedback[x.id]).length : 0;

  const setUrl = useCallback((attemptId: string) => {
    try { window.history.replaceState(null, "", `/subjects/${subject.id}/quizzes/${quizId}?attempt=${attemptId}`); } catch {}
  }, [subject.id, quizId]);

  const begin = useCallback(async (fresh: boolean) => {
    setLoadErr(null);
    const r = await startAttempt({ quizId, fresh }).catch(() => null);
    if (!r || !r.ok) { setLoadErr(r && !r.ok ? r.error : "We couldn't start this quiz. Try again."); return; }
    setView(r.view);
    setResults(null);
    setEnded(false);
    setStreak(0);
    setCurrentId(firstOpen(r.view));
    setChoice(null);
    setText("");
    setUrl(r.view.attemptId);
    requestAnimationFrame(() => promptRef.current?.focus());
  }, [quizId, setUrl]);

  // A page render never creates an attempt (prefetches can't make rows): the screen asks once it's here.
  const started = useRef(false);
  useEffect(() => {
    if (start.kind !== "start" || started.current) return;
    started.current = true;
    void begin(false);
  }, [start.kind, begin]);

  useEffect(() => () => speech.stopIf(owner), [owner]);

  const showResults = useCallback(async (withSound: boolean) => {
    if (!view) return;
    const r = await attemptResults(view.attemptId).catch(() => null);
    if (!r || !r.ok) { setActionErr("We couldn't load your results. Try again."); return; }
    if (withSound) play(celebrates(r.results.band) ? "cheer" : "pop");
    speech.stopIf(owner);
    setCelebrate(withSound);
    setResults(r.results);
  }, [view, play, owner]);

  // ---- answering --------------------------------------------------------------------
  const submit = useCallback(async (dontKnow: boolean) => {
    if (!view || !q || fb || checking) return;
    if (!dontKnow && (q.type === "mcq" ? choice === null : !text.trim())) return;
    let key = keys.current.get(q.id);
    if (!key) { key = crypto.randomUUID(); keys.current.set(q.id, key); }
    const payload = { attemptId: view.attemptId, questionId: q.id, clientKey: key, ...(dontKnow ? { dontKnow: true } : q.type === "mcq" ? { choice: choice! } : { text }) };
    setChecking(true);
    setActionErr(null);
    let res: Awaited<ReturnType<typeof checkAnswer>> | null = null;
    // Three tries with backoff (the client key makes a retry safe), then the offline message.
    for (let i = 0; i < 3 && !res; i++) {
      res = await checkAnswer(payload).catch(() => null);
      if (!res) { setNet("retrying"); await sleep(600 * 2 ** i); }
    }
    setChecking(false);
    if (!res) { setNet("offline"); return; }
    setNet("ok");
    if (!res.ok) { setActionErr(res.error); return; }
    const f = res.feedback;
    setView((v) => (v ? { ...v, feedback: { ...v.feedback, [f.questionId]: f }, finished: res.finished } : v));
    if (f.correct) {
      setHeading((h) => nextHeading(CORRECT_HEADINGS, h));
      setStreak((s) => s + 1);
      play("pop");
      if (!calm) setBurstKey((k) => k + 1);
    } else {
      setHeading(f.dontKnow ? "No worries. Here's the answer." : nextHeading(WRONG_HEADINGS, heading));
      setStreak(0);
      if (!f.dontKnow) {
        play("boop");
        if (!calm) void shake.start({ x: [0, -6, 6, -4, 4, 0], transition: { duration: 0.32, ease: "easeOut" } });
      }
    }
    requestAnimationFrame(() => feedbackRef.current?.focus());
  }, [view, q, fb, checking, choice, text, play, calm, heading, shake]);

  const goNext = useCallback(() => {
    if (!view || !q) return;
    speech.stopIf(owner);
    setConfirmOverride(false);
    setReportOpen(false);
    const after = view.questions.slice(index + 1).find((x) => !view.feedback[x.id]) ?? view.questions.find((x) => !view.feedback[x.id]);
    if (!after) { void showResults(true); return; }
    play("click");
    setCurrentId(after.id);
    setChoice(null);
    setText("");
    setActionErr(null);
    requestAnimationFrame(() => promptRef.current?.focus());
  }, [view, q, index, owner, play, showResults]);

  const doOverride = useCallback(async () => {
    if (!view || !q) return;
    const r = await overrideAnswer({ attemptId: view.attemptId, questionId: q.id }).catch(() => null);
    setConfirmOverride(false);
    if (!r || !r.ok) { play("boop"); setActionErr(r && !r.ok ? r.error : "Couldn't save that. Try again."); return; }
    const f = r.feedback;
    play("pop");
    setView((v) => (v ? { ...v, feedback: { ...v.feedback, [f.questionId]: f }, finished: r.finished } : v));
    setHeading("Counted as right.");
    requestAnimationFrame(() => feedbackRef.current?.focus());
  }, [view, q, play]);

  const doReport = useCallback(async (reason: (typeof REPORTS)[number]["reason"]) => {
    if (!view || !q) return;
    setReportOpen(false);
    const r = await reportQuestion({ attemptId: view.attemptId, questionId: q.id, reason }).catch(() => null);
    if (!r || !r.ok) { play("boop"); setActionErr("Couldn't save that. Try again."); return; }
    toast.show("Thanks. We took that question out of this quiz.");
    const rest = view.questions.filter((x) => x.id !== q.id);
    const feedback = { ...view.feedback };
    delete feedback[q.id];
    const nextView = { ...view, questions: rest, feedback, finished: r.finished };
    setView(nextView);
    setChoice(null);
    setText("");
    const after = rest.slice(index).find((x) => !feedback[x.id]) ?? rest.find((x) => !feedback[x.id]);
    if (after) { setCurrentId(after.id); requestAnimationFrame(() => promptRef.current?.focus()); }
    else if (rest.length) { setCurrentId(null); const res = await attemptResults(view.attemptId).catch(() => null); if (res?.ok) setResults(res.results); }
    else setCurrentId(null);
  }, [view, q, index, play, toast]);

  const end = useCallback(() => { play("click"); speech.stopIf(owner); setEnded(true); }, [play, owner]);

  // ---- keyboard -----------------------------------------------------------------------
  useEffect(() => {
    if (!view || results || ended) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector("dialog[open]")) return;
      const t = e.target as HTMLElement;
      const inField = !!t.closest("input[type=text], textarea, select, [contenteditable]");
      const k = e.key;
      if (k === "Escape") { e.preventDefault(); end(); return; }
      if (k === "Enter") {
        if (t.closest("button, a")) return; // the focused control handles it
        if (!fb && (q?.type === "mcq" ? choice !== null : text.trim())) { e.preventDefault(); void submit(false); }
        else if (fb && !inField) { e.preventDefault(); goNext(); }
        return;
      }
      if (inField) return;
      if (k === "?") { play("click"); setHelp(true); return; }
      if ((k === "r" || k === "R") && fb) { document.querySelector<HTMLButtonElement>("[data-quiz-read] button")?.click(); return; }
      if (q?.type === "mcq" && !fb && q.options) {
        const i = ["1", "2", "3", "4"].indexOf(k) >= 0 ? Number(k) - 1 : ["a", "b", "c", "d"].indexOf(k.toLowerCase());
        if (i >= 0 && i < q.options.length) { e.preventDefault(); play("click"); setChoice(i); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, results, ended, fb, q, choice, text, submit, goNext, end, play]);

  const colours = useMemo(() => ["var(--success)", "var(--highlight)", "var(--subject)"], []);

  // ---- render -------------------------------------------------------------------------
  const backLink = <Link href={`/subjects/${subject.id}/quizzes`} className="btn" onClick={() => play("click")}>Back to quizzes</Link>;
  const frame = (children: React.ReactNode) => <div className="flex flex-col gap-6" style={subjectStyle(subject.colour)}>{children}</div>;

  if (results) {
    return frame(
      <QuizResults subject={subject} results={results} celebrate={celebrate && !calm} calm={calm} onRetake={() => begin(true)} onChange={setResults} />,
    );
  }
  if (loadErr) {
    return frame(
      <div role="alert" className="sticker mx-auto mt-10 flex max-w-md flex-col items-center gap-3 p-6 text-center">
        <p className="font-display text-2xl">{loadErr}</p>
        <div className="flex flex-wrap justify-center gap-2">{backLink}<Button variant="primary" onClick={() => void begin(false)}>Try again</Button></div>
      </div>,
    );
  }
  if (!view) {
    return frame(
      <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading your quiz">
        <div className="skeleton h-10" />
        <div className="skeleton mx-auto h-64 w-full max-w-[680px]" />
        <button type="button" className="btn btn-primary mx-auto" disabled>Check</button>
      </div>,
    );
  }
  if (!view.questions.length) {
    return frame(
      <div className="sticker relative mx-auto mt-10 flex max-w-md flex-col items-center gap-3 p-8 text-center">
        <span className="tape" aria-hidden="true" />
        <h1 className="font-display text-2xl">Every question in this quiz was taken out. Make a fresh one?</h1>
        <Link href={`/subjects/${subject.id}/quizzes?make=1`} className="btn btn-primary" onClick={() => play("click")}>Make a quiz</Link>
      </div>,
    );
  }

  const topBar = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!ended && <Button variant="ghost" size="sm" onClick={end}>✕ End</Button>}
        <SubjectChip name={subject.name} emoji={subject.emoji} colour={subject.colour} />
        <span className="min-w-0 max-w-[40ch] flex-1 truncate font-bold" title={title}>{title}</span>
        <div className="ml-auto flex items-center gap-2">
          {streak >= 3 && <span className="chip chip-due pop-in" data-testid="streak">{streak} in a row 🔥</span>}
          {q && !ended && <span className="text-sm font-bold" data-testid="progress-text">Question {index + 1} of {total}</span>}
          <Button variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => setHelp(true)}>Keyboard shortcuts</Button>
        </div>
      </div>
      <div
        role="progressbar" aria-label="Quiz progress" aria-valuemin={0} aria-valuemax={total} aria-valuenow={answered} aria-valuetext={`${answered} of ${total} answered`}
        className="h-[6px] overflow-hidden rounded-full border-2 border-[var(--ink)] bg-[var(--grid)] box-content"
      >
        <div className="h-full bg-[var(--highlight)] transition-[width] duration-300" style={{ width: `${total ? (answered / total) * 100 : 0}%` }} />
      </div>
    </div>
  );

  const shortcuts = (
    <Dialog open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <dt className="font-bold">1–4 or A–D</dt><dd>Choose an option</dd>
        <dt className="font-bold">Enter</dt><dd>Check, then next question</dd>
        <dt className="font-bold">R</dt><dd>Read aloud (after checking)</dd>
        <dt className="font-bold">Esc</dt><dd>End (your answers are saved)</dd>
        <dt className="font-bold">?</dt><dd>These shortcuts</dd>
      </dl>
      <div className="flex justify-end"><Button onClick={() => setHelp(false)}>Close</Button></div>
    </Dialog>
  );

  if (ended || !q) {
    return frame(
      <>
        {topBar}
        <div className="sticker mx-auto mt-6 flex max-w-lg flex-col items-center gap-3 p-8 text-center" role="status">
          <h1 className="font-display text-3xl">Saved!</h1>
          <p>You answered {answered} of {total}. Come back any time to finish.</p>
          <div className="flex flex-col-reverse justify-center gap-2 sm:flex-row">
            {backLink}
            {answered < total && <Button variant="primary" onClick={() => { setEnded(false); if (!q) setCurrentId(firstOpen(view)); }}>Keep going</Button>}
            {answered >= total && <Button variant="primary" onClick={() => void showResults(false)}>See results</Button>}
          </div>
        </div>
        {shortcuts}
      </>,
    );
  }

  const isLast = !view.questions.some((x) => x.id !== q.id && !view.feedback[x.id]);
  const promptId = `${uid}-prompt`;
  const optionState = (i: number): "right" | "wrong" | undefined => {
    if (!fb || fb.correctChoice === null) return undefined;
    if (i === fb.correctChoice) return "right";
    if (i === fb.choice && !fb.correct) return "wrong";
    return undefined;
  };

  return frame(
    <>
      {topBar}
      <motion.section
        key={q.id} aria-labelledby={promptId}
        initial={calm ? { opacity: 0 } : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        transition={calm ? { duration: 0.15 } : { type: "spring", stiffness: 300, damping: 26 }}
        className="mx-auto flex w-full max-w-[680px] flex-col gap-4 sm:w-[600px] lg:w-[680px]"
      >
        <motion.div animate={shake} className="sticker relative flex min-h-[360px] flex-col gap-4 p-4 pt-6 sm:p-6">
          <span className="washi flex items-center justify-center text-xs" aria-hidden="true">{subject.emoji}</span>
          <span className="text-sm text-ink-soft">{q.topic}</span>
          {q.type === "mcq" && q.options ? (
            <fieldset className="flex flex-col gap-3" disabled={!!fb || checking}>
              <legend className="mb-3">
                <h1 id={promptId} ref={promptRef} tabIndex={-1} className="max-w-[65ch] text-xl font-bold outline-none">
                  <span className="sr-only">Question {index + 1} of {total}, {q.topic}. </span>{q.prompt}
                </h1>
              </legend>
              {q.options.map((o, i) => {
                const st = optionState(i);
                const mine = fb && fb.choice === i;
                return (
                  <label key={i} className="option" data-state={st} data-testid="option">
                    <input type="radio" className="sr-only" name={`${uid}-opt`} checked={fb ? fb.choice === i : choice === i}
                      onChange={() => { play("click"); setChoice(i); }} />
                    <span className="option-key" aria-hidden="true">{LETTERS[i]}</span>
                    <span className="sr-only">{LETTERS[i]}, </span>
                    <span className="flex-1">{o}</span>
                    {(st || mine) && (
                      <span className="flex items-center gap-2">
                        <span className="state-label">{st === "right" ? (mine ? "Your answer, right answer" : "Right answer") : "Your answer"}</span>
                        {st && (
                          <motion.span className="badge" aria-hidden="true" initial={calm ? false : { scale: 0.4 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 18 }}>
                            {st === "right" ? "✓" : "✗"}
                          </motion.span>
                        )}
                        {st === "right" && fb?.correct && <Burst key={burstKey} colours={colours} />}
                      </span>
                    )}
                  </label>
                );
              })}
            </fieldset>
          ) : (
            <div className="flex flex-col gap-3">
              <h1 id={promptId} ref={promptRef} tabIndex={-1} className="max-w-[65ch] text-xl font-bold outline-none">
                <span className="sr-only">Question {index + 1} of {total}, {q.topic}. </span>
                <BlankPrompt prompt={q.prompt} typed={fb ? fb.given : text} />
              </h1>
              <label htmlFor={`${uid}-answer`} className="label">Your answer</label>
              <div className="relative flex items-center gap-2">
                <input
                  id={`${uid}-answer`} type="text" className={`input text-xl ${fb ? (fb.correct ? "input-right" : fb.dontKnow ? "" : "input-wrong") : ""}`}
                  value={fb ? fb.given : text} readOnly={!!fb} maxLength={200}
                  autoComplete="off" autoCapitalize="off" spellCheck={false} enterKeyHint="done" aria-describedby={promptId}
                  onChange={(e) => setText(e.target.value)}
                />
                {fb && !fb.dontKnow && (
                  <motion.span className="badge relative" aria-hidden="true" initial={calm ? false : { scale: 0.4 }} animate={{ scale: 1 }}>
                    {fb.correct ? "✓" : "✗"}
                    {fb.correct && <Burst key={burstKey} colours={colours} />}
                  </motion.span>
                )}
              </div>
            </div>
          )}
        </motion.div>

        {!fb ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" onClick={() => void submit(true)} disabled={checking}>I don&apos;t know</Button>
              <Button variant="primary" sound={null} className="w-full sm:w-auto" disabled={checking || (q.type === "mcq" ? choice === null : !text.trim())} onClick={() => void submit(false)}>
                Check
              </Button>
            </div>
            {net === "retrying" && <p className="hint text-right" role="status">Couldn&apos;t check that. Trying again…</p>}
            {net === "offline" && (
              <div className="flex flex-wrap items-center justify-end gap-2" role="alert">
                <p className="hint">You&apos;re offline. Check again when you&apos;re back.</p>
                <Button size="sm" onClick={() => void submit(false)}>Try again</Button>
              </div>
            )}
            {actionErr && <p role="alert" className="error-text w-fit self-end">{actionErr}</p>}
          </div>
        ) : (
          <FeedbackPanel
            q={q} fb={fb} heading={heading ?? (fb.correct ? CORRECT_HEADINGS[0] : fb.dontKnow ? "No worries. Here's the answer." : WRONG_HEADINGS[0])}
            headingRef={feedbackRef} owner={owner} isLast={isLast} onNext={goNext}
            confirmOverride={confirmOverride} setConfirmOverride={setConfirmOverride} onOverride={doOverride}
            reportOpen={reportOpen} setReportOpen={setReportOpen} onReport={doReport} error={actionErr}
          />
        )}
      </motion.section>
      {shortcuts}
      {toast.node}
    </>,
  );
}

function firstOpen(view: PlayView): string | null {
  return view.questions.find((x) => !view.feedback[x.id])?.id ?? null;
}

function FeedbackPanel({ q, fb, heading, headingRef, owner, isLast, onNext, confirmOverride, setConfirmOverride, onOverride, reportOpen, setReportOpen, onReport, error }: {
  q: PlayQuestion;
  fb: Feedback;
  heading: string;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  owner: string;
  isLast: boolean;
  onNext: () => void;
  confirmOverride: boolean;
  setConfirmOverride: (v: boolean) => void;
  onOverride: () => void;
  reportOpen: boolean;
  setReportOpen: (v: boolean) => void;
  onReport: (reason: (typeof REPORTS)[number]["reason"]) => void;
  error: string | null;
}) {
  const { play } = useSound();
  const spoken = fb.correct ? heading : `${heading} Right answer: ${fb.answer}.`;
  return (
    <div className="sticker-flat flex flex-col gap-3 p-4" data-testid="feedback">
      <div aria-live="polite">
        <h2 ref={headingRef} tabIndex={-1} className="text-xl font-bold outline-none">
          {heading}
          <span className="sr-only">{spoken.slice(heading.length)}</span>
        </h2>
      </div>
      {fb.correct && fb.typo && <p>(watch the spelling: <em>{fb.answer}</em>)</p>}
      {q.type === "fill" && !fb.correct && <p>Right answer: <strong data-testid="right-answer">{fb.answer}</strong></p>}
      {fb.overridden && <p className="hint">Counted as right. We&apos;ll accept that answer next time.</p>}
      {fb.explanation && <p>{fb.explanation}</p>}
      <SourceQuote quote={fb.quote} source={fb.source} newTab />
      <div className="flex flex-wrap items-center gap-2">
        <span data-quiz-read>
          <ReadAloudButton owner={owner} label="question, answer and explanation"
            parts={() => [{ part: "q", text: q.prompt.replaceAll(BLANK, "blank") }, { part: "a", text: `Answer: ${fb.answer}.`, gapBefore: 400 }, { part: "e", text: fb.explanation, gapBefore: 400 }]} />
        </span>
      </div>
      {fb.canOverride && !fb.overridden && (
        confirmOverride ? (
          <div role="group" aria-label="Count your answer as right?" className="flex flex-wrap items-center gap-2">
            <span className="font-bold">Count &lsquo;{fb.given}&rsquo; as right?</span>
            <Button size="sm" variant="primary" sound={null} onClick={onOverride}>Count it</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmOverride(false)}>No</Button>
          </div>
        ) : (
          <button type="button" className="min-h-11 w-fit text-sm font-bold underline underline-offset-2" onClick={() => { play("click"); setConfirmOverride(true); }}>
            I think my answer is right
          </button>
        )
      )}
      {error && <p role="alert" className="error-text w-fit">{error}</p>}
      <div className="flex flex-col gap-1 sm:items-end">
        <Button variant="primary" sound={null} className="w-full sm:w-auto" onClick={onNext}>{isLast ? "See results" : "Next question"}</Button>
        <div className="relative self-end">
          <button type="button" className="min-h-11 px-2 text-sm text-ink-soft underline underline-offset-2" aria-expanded={reportOpen} onClick={() => { play("click"); setReportOpen(!reportOpen); }}>
            Report a problem
          </button>
          {reportOpen && (
            <ul className="sticker absolute bottom-full right-0 z-30 mb-2 flex min-w-56 flex-col p-1">
              {REPORTS.map((r) => (
                <li key={r.reason}>
                  <button type="button" className="flex min-h-11 w-full items-center rounded-md px-3 text-left font-bold hover:bg-highlight hover:text-[var(--on-colour)]"
                    onClick={() => { play("click"); onReport(r.reason); }}>{r.label}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
