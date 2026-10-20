"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { Quota } from "@/lib/limits/ai";
import { bestScoreCopy } from "@/lib/quiz/copy";
import { isGoodScore } from "@/lib/quiz/order";
import { timeAgo } from "@/lib/time";
import { deleteQuiz, restoreQuiz, startAttempt } from "@/server/actions/quiz";
import type { SubjectLite } from "@/server/cards";
import type { ShelfQuiz, WeakSummary } from "@/server/quiz";
import { NoSources } from "../no-sources";
import { useSound } from "../sound-provider";
import { SubjectChip } from "../subject-chip";
import { useActionToast } from "../ui/action-toast";
import { Button } from "../ui/button";
import { QuotaChip } from "../ui/quota-chip";
import { RowMenu } from "../ui/row-menu";
import { subjectStyle } from "../ui/subject-style";
import { MakeQuizDialog, type QuizPreset } from "./make-quiz-dialog";

const PAGE = 20;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** The quiz shelf (quiz-builder.md): make, practise weak topics, resume, take, retake, delete. */
export function QuizShelf({ subject, quizzes, weak, quota: initialQuota, hasSources, openMake }: {
  subject: SubjectLite;
  quizzes: ShelfQuiz[];
  weak: WeakSummary;
  quota: Quota;
  hasSources: boolean;
  /** Opened from elsewhere ("Make a quiz" links). */
  openMake?: boolean;
}) {
  const [quota, setQuota] = useState(initialQuota);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(PAGE);
  const [make, setMake] = useState<QuizPreset | "plain" | null>(openMake ? "plain" : null);
  const [glowId, setGlowId] = useState<string | null>(null);
  const [restartAsk, setRestartAsk] = useState(false);
  const { play } = useSound();
  const toast = useActionToast();
  const router = useRouter();
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => { if (!glowId) return; const t = setTimeout(() => setGlowId(null), 1500); return () => clearTimeout(t); }, [glowId]);

  const list = quizzes.filter((q) => !hidden.has(q.id));
  const best = list.reduce<{ score: number; total: number } | null>((b, q) => (q.best && (!b || q.best.score / q.best.total > b.score / b.total) ? q.best : b), null);
  const summary = [`${list.length} ${list.length === 1 ? "quiz" : "quizzes"}`, best && best.score > 0 ? `best ${best.score}/${best.total}` : null, weak.count ? plural(weak.count, "weak topic") : null].filter(Boolean).join(" · ");
  const resume = list.find((q) => q.unfinished && q.unfinished.answered > 0);

  async function remove(q: ShelfQuiz) {
    const r = await deleteQuiz(q.id);
    if (!r.ok) { play("boop"); toast.show("Couldn't delete. Try again."); return; }
    setHidden((s) => new Set(s).add(q.id));
    toast.show("Quiz deleted", {
      label: "Undo",
      onClick: async () => {
        const u = await restoreQuiz(q.id);
        if (u.ok) setHidden((s) => { const n = new Set(s); n.delete(q.id); return n; });
      },
    });
  }

  async function startOver(q: ShelfQuiz) {
    const r = await startAttempt({ quizId: q.id, fresh: true });
    if (!r.ok) { play("boop"); toast.show(r.error); return; }
    router.push(`/subjects/${subject.id}/quizzes/${q.id}?attempt=${r.view.attemptId}`);
  }

  // The quota chip sits straight after the button it limits (polish.md P2-4).
  const makeButton = (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" className="flex-1 sm:flex-none" onClick={() => setMake("plain")} aria-describedby="quiz-quota">Make a quiz</Button>
      <QuotaChip quota={quota} id="quiz-quota" />
    </div>
  );

  return (
    <div className="flex flex-col gap-6" style={subjectStyle(subject.colour)}>
      {/* Header and actions share the list's left edge (polish.md P2-4). */}
      <div className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
        <header className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/subjects/${subject.id}`} className="inline-flex min-h-11 items-center font-bold underline-offset-4 hover:underline" onClick={() => play("click")}>← {subject.name}</Link>
            <SubjectChip name={subject.name} emoji={subject.emoji} colour={subject.colour} />
          </div>
          <h1 className="font-display text-3xl sm:text-4xl">Quizzes</h1>
          {list.length > 0 && <p className="text-ink-soft" data-testid="quiz-summary">{summary}</p>}
        </header>

        {list.length > 0 && (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
            {makeButton}
            {weak.count > 0 && (
              <Button className="w-full sm:w-auto" onClick={() => setMake({ type: "weak" })}>Practise weak topics · {weak.count}</Button>
            )}
          </div>
        )}
      </div>

      {resume?.unfinished && (
        <div className="sticker relative mx-auto flex w-full max-w-[880px] flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid="resume">
          <span className="tape" aria-hidden="true" />
          <p className="flex-1">Pick up where you left off: <strong>{resume.title}</strong> quiz, question {Math.min(resume.unfinished.answered + 1, resume.unfinished.total)} of {resume.unfinished.total}</p>
          {restartAsk ? (
            <div role="group" aria-label="Start again?" className="flex flex-wrap items-center gap-2">
              <span className="text-sm">Start this quiz again from question 1? Your answers so far are kept in your weak topics.</span>
              <Button size="sm" variant="primary" onClick={() => void startOver(resume)}>Start over</Button>
              <Button size="sm" variant="ghost" onClick={() => setRestartAsk(false)}>Keep going instead</Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <Link href={`/subjects/${subject.id}/quizzes/${resume.id}?attempt=${resume.unfinished.attemptId}`} className="btn btn-primary" onClick={() => play("click")}>Keep going</Link>
              <Button variant="ghost" onClick={() => setRestartAsk(true)}>Start over</Button>
            </div>
          )}
        </div>
      )}

      {list.length === 0 && !hasSources ? (
        <NoSources subjectId={subject.id} title="No quizzes yet" then="quiz you on it" testId="quiz-no-sources" />
      ) : list.length === 0 ? (
        <div className="sticker relative mx-auto mt-4 flex max-w-lg flex-col items-center gap-3 p-8 text-center">
          <span className="tape" aria-hidden="true" />
          <p className="font-display text-3xl">No quizzes yet</p>
          <p className="text-ink-soft">Test yourself on your notes. Wrong answers just show what to look at next.</p>
          {makeButton}
        </div>
      ) : (
        <ol ref={listRef} className="mx-auto flex w-full max-w-[880px] flex-col gap-6" aria-label="Quizzes">
          {list.slice(0, shown).map((q) => (
            <li key={q.id}>
              <QuizSticker subjectId={subject.id} quiz={q} glow={glowId === q.id} onDelete={() => void remove(q)} />
            </li>
          ))}
        </ol>
      )}
      {list.length > shown && (
        <div className="flex justify-center"><Button onClick={() => setShown(shown + PAGE)}>Show 20 more</Button></div>
      )}

      {make !== null && (
        <MakeQuizDialog
          subjectId={subject.id} subjectName={subject.name} open onClose={() => setMake(null)} preset={make === "plain" ? null : make}
          onMade={(id, q) => { setQuota(q); setGlowId(id); }}
        />
      )}
      {toast.node}
    </div>
  );
}

function QuizSticker({ subjectId, quiz, glow, onDelete }: { subjectId: string; quiz: ShelfQuiz; glow: boolean; onDelete: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const { play } = useSound();
  const router = useRouter();
  const headingId = `quiz-${quiz.id}`;
  const href = `/subjects/${subjectId}/quizzes/${quiz.id}`;
  return (
    <article aria-labelledby={headingId} className={`sticker relative flex flex-col gap-3 p-4 sm:p-5 ${glow ? "glow" : ""}`}>
      <span className="washi" aria-hidden="true" />
      <div>
        <h2 id={headingId} className="text-lg font-bold">{quiz.title}</h2>
        <p className="text-sm text-ink-soft">{plural(quiz.questionCount, "question")} · made {timeAgo(quiz.createdAt)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {quiz.best && quiz.best.score === 0 ? (
          // Never "Best 0/9" (polish.md P2-12); the one chip carries the tries too.
          <span className="chip">{bestScoreCopy(quiz.best, quiz.tries).text}</span>
        ) : quiz.best ? (
          <>
            <span className={`chip ${isGoodScore(quiz.best.score, quiz.best.total) ? "chip-good" : ""}`}>
              <span aria-hidden="true">{bestScoreCopy(quiz.best, quiz.tries).text}</span>
              <span className="sr-only">{bestScoreCopy(quiz.best, quiz.tries).label}</span>
            </span>
            <span className="chip">Tried {quiz.tries === 1 ? "once" : `${quiz.tries} times`}</span>
          </>
        ) : (
          <span className="chip">New</span>
        )}
      </div>
      {confirming ? (
        <div role="group" aria-label="Delete this quiz?" className="flex flex-wrap items-center gap-2">
          <span className="font-bold">Delete this quiz? Your weak topics stay.</span>
          <Button size="sm" variant="danger" sound="tear" onClick={onDelete}>Delete</Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <Link href={href} className="btn btn-primary btn-sm" aria-label={`${quiz.tries ? "Retake" : "Take"} quiz: ${quiz.title}`} onClick={() => play("click")}>
            {quiz.tries ? "Retake" : "Take quiz"}
          </Link>
          <RowMenu label={`More for ${quiz.title}`} items={[
            ...(quiz.lastFinished ? [{ label: "See last results", onSelect: () => router.push(`${href}?attempt=${quiz.lastFinished}`) }] : []),
            { label: "Delete quiz", onSelect: () => setConfirming(true), danger: true },
          ]} />
        </div>
      )}
    </article>
  );
}
