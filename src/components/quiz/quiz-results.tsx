"use client";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { splitAccepted } from "@/lib/quiz/match";
import { BAND_TITLE, celebrates } from "@/lib/quiz/order";
import { attemptResults, editQuestion, removeQuestion } from "@/server/actions/quiz";
import type { SubjectLite } from "@/server/cards";
import type { ResultRow, ResultsView } from "@/server/quiz";
import { SUBJECT_COLOURS } from "@/lib/subjects";
import { SourceQuote } from "../flashcards/source-quote";
import { Confetti } from "../review/confetti";
import { useSound } from "../sound-provider";
import { useActionToast } from "../ui/action-toast";
import { Button } from "../ui/button";
import { RowMenu } from "../ui/row-menu";
import { MakeQuizDialog, type QuizPreset } from "./make-quiz-dialog";

/** Results (quiz.md "Results"): score sticker, weak-topic line, next steps and the answer list. */
export function QuizResults({ subject, results, celebrate, calm, onRetake, onChange }: {
  subject: SubjectLite;
  results: ResultsView;
  /** Confetti (only when the score earns it and motion is allowed). */
  celebrate: boolean;
  calm: boolean;
  onRetake: () => void;
  onChange: (r: ResultsView) => void;
}) {
  const r = results;
  const missed = r.rows.filter((x) => !x.correct);
  const pct = r.total ? Math.round((r.score / r.total) * 100) : 0;
  const [filter, setFilter] = useState<"all" | "missed">(pct < 70 && missed.length ? "missed" : "all");
  const [make, setMake] = useState<QuizPreset | "plain" | null>(null);
  const [everMade, setEverMade] = useState(false);
  const { play } = useSound();
  const toast = useActionToast();
  const uid = useId();
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => { headingRef.current?.focus(); }, []);

  const openMake = (p: QuizPreset | "plain") => { setEverMade(true); setMake(p); };
  const missedTopics = [...new Set(missed.map((m) => m.topic))];
  const rows = filter === "missed" ? missed : r.rows;
  const refresh = async () => { const res = await attemptResults(r.attemptId); if (res.ok) onChange(res.results); };
  const showStar = celebrates(r.band) && calm;

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/subjects/${subject.id}/quizzes`} className="inline-flex min-h-11 items-center font-bold underline-offset-4 hover:underline" onClick={() => play("click")}>← Quizzes</Link>
      </div>
      {celebrate && celebrates(r.band) && <Confetti colours={[SUBJECT_COLOURS[subject.colour], "var(--highlight)"]} />}
      <section aria-labelledby={`${uid}-h`} className="sticker relative mx-auto mt-2 flex w-full max-w-lg flex-col items-center gap-2 p-6 text-center sm:p-8" style={{ rotate: calm ? "0deg" : "-1deg" }}>
        <span className="tape" aria-hidden="true" />
        {showStar && <span aria-hidden="true" className="text-5xl">⭐</span>}
        <h1 id={`${uid}-h`} ref={headingRef} tabIndex={-1} className="font-display text-4xl outline-none">{BAND_TITLE[r.band]}</h1>
        <p className="text-[40px] font-bold leading-none" data-testid="score">{r.score} / {r.total}</p>
        <p className="text-ink-soft">{pct} % · {r.minutes} {r.minutes === 1 ? "minute" : "minutes"}</p>
        {r.band === "practice" && <p>Every miss shows you exactly what to look at next.</p>}
        <p className="sr-only" role="status">Quiz finished. You scored {r.score} out of {r.total}.</p>
      </section>

      {(r.added.length > 0 || r.stronger.length > 0) && (
        <div className="sticker-flat mx-auto flex w-full max-w-lg flex-col gap-1 p-4" data-testid="weak-line">
          {r.added.length > 0 && (
            <p>Added to your weak topics: {r.added.map((t, i) => <span key={t.key}>{i > 0 && ", "}<strong>{t.name}</strong></span>)}</p>
          )}
          {r.stronger.length > 0 && (
            <p>Getting stronger: {r.stronger.map((t, i) => <span key={t.key}>{i > 0 && ", "}<strong>{t.name}</strong></span>)} (1 more right to clear it)</p>
          )}
          <Link href={`/subjects/${subject.id}/weak-topics`} className="min-h-11 w-fit content-center font-bold underline underline-offset-2" onClick={() => play("click")}>See weak topics</Link>
        </div>
      )}

      <div className="mx-auto flex w-full max-w-lg flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
        {missed.length > 0 ? (
          <>
            <Button variant="primary" className="w-full sm:w-auto" onClick={() => openMake({ type: "weak", topics: missedTopics })}>Practise what I missed</Button>
            <Button className="w-full sm:w-auto" onClick={onRetake}>Retake this quiz</Button>
            <Link href={`/subjects/${subject.id}/quizzes`} className="btn btn-ghost w-full sm:w-auto" onClick={() => play("click")}>Back to quizzes</Link>
          </>
        ) : (
          <>
            <Button className="w-full sm:w-auto" onClick={onRetake}>Retake this quiz</Button>
            <Link href={`/subjects/${subject.id}`} className="btn btn-ghost w-full sm:w-auto" onClick={() => play("click")}>Back to {subject.name}</Link>
          </>
        )}
      </div>
      {missed.length === 0 && (
        <p className="mx-auto flex flex-wrap items-center justify-center gap-2 text-center">
          Nothing to practise. Make a new quiz on other pages?
          <Button size="sm" onClick={() => openMake("plain")}>Make a quiz</Button>
        </p>
      )}

      <section aria-labelledby={`${uid}-answers`} className="mx-auto flex w-full max-w-[760px] flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id={`${uid}-answers`} className="text-2xl font-bold">Your answers</h2>
          <div className="seg" role="radiogroup" aria-label="Show answers">
            {(["all", "missed"] as const).map((f) => (
              <label key={f}>
                <input type="radio" className="sr-only" name={`${uid}-filter`} checked={filter === f} onChange={() => { play("click"); setFilter(f); }} />
                {f === "all" ? "All" : `Missed (${missed.length})`}
              </label>
            ))}
          </div>
        </div>
        {rows.length === 0 && <p className="hint">Nothing missed. Nice!</p>}
        <ol className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.questionId}>
              <AnswerRow row={row} onEdited={refresh} onRemove={async () => {
                const res = await removeQuestion({ attemptId: r.attemptId, questionId: row.questionId });
                if (!res.ok) { play("boop"); toast.show("Couldn't save that. Try again."); return; }
                toast.show("Question removed from this quiz.");
                await refresh();
              }} />
            </li>
          ))}
        </ol>
      </section>
      {everMade && (
        <MakeQuizDialog subjectId={subject.id} subjectName={subject.name} open={!!make} onClose={() => setMake(null)}
          preset={make && make !== "plain" ? make : null} />
      )}
      {toast.node}
    </>
  );
}

function AnswerRow({ row, onEdited, onRemove }: { row: ResultRow; onEdited: () => Promise<void>; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const { play } = useSound();
  const short = row.prompt.length > 40 ? `${row.prompt.slice(0, 39)}…` : row.prompt;
  return (
    <article className="sticker-flat flex flex-col gap-2 p-3" aria-label={row.prompt}>
      <div className="flex items-start gap-3">
        <span className={`chip ${row.correct ? "chip-good" : "chip-limit"}`}>
          <span aria-hidden="true">{row.correct ? "✓" : "✗"}</span> {row.correct ? "Right" : "Missed"}
        </span>
        <p className="min-w-0 flex-1 font-bold">{row.prompt}</p>
        <RowMenu label={`More for question: ${short}`} items={[
          { label: "Edit question", onSelect: () => setEditing(true) },
          { label: "Remove from quiz", onSelect: onRemove, danger: true },
        ]} />
      </div>
      {editing ? (
        <QuestionEditor row={row} onCancel={() => setEditing(false)} onSaved={async () => { setEditing(false); play("pop"); await onEdited(); }} />
      ) : (
        <>
          <p className="text-sm">
            Your answer: {row.dontKnow ? <em>I don&apos;t know</em> : row.given || <em>none</em>}
            {!row.correct && <> · Right answer: <strong>{row.answer}</strong></>}
            {row.overridden && <span className="hint"> (counted as right)</span>}
          </p>
          {row.edited && <span className="chip w-fit">Edited</span>}
          <details className="text-sm">
            <summary className="min-h-11 w-fit cursor-pointer content-center font-bold" onClick={() => play("click")}>Why?</summary>
            <div className="flex flex-col gap-2 pt-1">
              {row.explanation && <p>{row.explanation}</p>}
              <SourceQuote quote={row.quote} source={row.source} newTab />
            </div>
          </details>
        </>
      )}
    </article>
  );
}

function QuestionEditor({ row, onCancel, onSaved }: { row: ResultRow; onCancel: () => void; onSaved: () => Promise<void> }) {
  const [prompt, setPrompt] = useState(row.prompt);
  const [explanation, setExplanation] = useState(row.explanation);
  const [options, setOptions] = useState<string[]>(row.options ?? []);
  const [correct, setCorrect] = useState(row.correctIndex ?? 0);
  const [answer, setAnswer] = useState(row.answer);
  const [accepted, setAccepted] = useState(row.accepted.join(", "));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { play } = useSound();
  const uid = useId();
  async function save() {
    setSaving(true);
    const res = await editQuestion(row.type === "mcq"
      ? { questionId: row.questionId, prompt, explanation, options, correctIndex: correct }
      : { questionId: row.questionId, prompt, explanation, answer, accepted: splitAccepted(accepted) }).catch(() => null);
    setSaving(false);
    if (!res || !res.ok) { play("boop"); setError(res && !res.ok ? res.error : "Couldn't save. Try again."); return; }
    await onSaved();
  }
  return (
    <form className="flex flex-col gap-3" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <div className="field">
        <label htmlFor={`${uid}-p`}>Question</label>
        <textarea id={`${uid}-p`} className="input" rows={2} value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} />
      </div>
      {row.type === "mcq" ? (
        <fieldset className="flex flex-col gap-2">
          <legend className="label">Options (pick the right one)</legend>
          {options.map((o, i) => (
            <div key={i} className="flex items-center gap-2">
              <input type="radio" name={`${uid}-c`} className="h-5 w-5 accent-[var(--ink)]" checked={correct === i} onChange={() => setCorrect(i)} aria-label={`Option ${i + 1} is right`} />
              <label className="sr-only" htmlFor={`${uid}-o${i}`}>Option {i + 1}</label>
              <input id={`${uid}-o${i}`} className="input" value={o} maxLength={160} onChange={(e) => setOptions((list) => list.map((x, j) => (j === i ? e.target.value : x)))} />
            </div>
          ))}
        </fieldset>
      ) : (
        <>
          <div className="field">
            <label htmlFor={`${uid}-a`}>Answer</label>
            <input id={`${uid}-a`} className="input" value={answer} maxLength={60} onChange={(e) => setAnswer(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor={`${uid}-alt`}>Other answers that count (comma separated)</label>
            <input id={`${uid}-alt`} className="input" value={accepted} onChange={(e) => setAccepted(e.target.value)} />
          </div>
        </>
      )}
      <div className="field">
        <label htmlFor={`${uid}-e`}>Explanation</label>
        <textarea id={`${uid}-e`} className="input" rows={2} value={explanation} maxLength={400} onChange={(e) => setExplanation(e.target.value)} />
      </div>
      {error && <p role="alert" className="error-text w-fit">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" sound={null} disabled={saving}>Save</Button>
      </div>
    </form>
  );
}
