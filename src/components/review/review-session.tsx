"use client";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pickNext, requeue, type QueueItem } from "@/lib/srs/due";
import { formatInterval } from "@/lib/srs/format";
import { gradeCard, previewIntervals, RATING_LABEL, RATINGS, type Rating, type SrsState } from "@/lib/srs/scheduler";
import { SUBJECT_COLOURS } from "@/lib/subjects";
import { reviewCard, sessionOutlook, undoReview, type SessionOutlook } from "@/server/actions/review";
import { updateCard } from "@/server/actions/flashcards";
import type { DeckCard, SubjectLite } from "@/server/cards";
import { CardEditor } from "../flashcards/card-editor";
import { SourceQuote } from "../flashcards/source-quote";
import { ReadAloudButton, segmentsOf, SpokenText } from "../read-aloud/read-aloud-button";
import { readPrefs, speech, writePrefs } from "../read-aloud/speech";
import { useSound } from "../sound-provider";
import { SubjectChip } from "../subject-chip";
import { useActionToast } from "../ui/action-toast";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { subjectStyle } from "../ui/subject-style";
import { Confetti } from "./confetti";

type Op = { kind: "grade"; key: string; cardId: string; rating: Rating } | { kind: "undo"; key: string; cardId: string };
type HistoryEntry = { key: string; cardId: string; rating: Rating; prevSrs: SrsState; prevQueue: QueueItem[] };

const short = (s: string) => (s.length > 120 ? `${s.slice(0, 119)}…` : s);

function outlookLine(o: SessionOutlook | null): string | null {
  if (!o) return null;
  if (o.tomorrow > 0) return `Next up: ${o.tomorrow} ${o.tomorrow === 1 ? "card" : "cards"} tomorrow.`;
  if (o.nextDueAt) {
    const days = Math.max(2, Math.round((Date.parse(o.nextDueAt) - Date.now()) / 86_400_000));
    return days <= 6
      ? `Next: cards on ${new Date(o.nextDueAt).toLocaleDateString("en", { weekday: "long" })}.`
      : `Nothing due for ${days} days. Nice.`;
  }
  return null;
}

/**
 * Review session (review.md). One card, four grades. The server saves each grade with its own
 * clock; grades are queued and sent in order, so the session keeps going while offline.
 */
export function ReviewSession({ subject, subjects, initialQueue, initialOutlook, totalCards }: {
  /** null = every subject (/review). */
  subject: SubjectLite | null;
  subjects: SubjectLite[];
  initialQueue: DeckCard[];
  initialOutlook: SessionOutlook | null;
  totalCards: number;
}) {
  const [cards, setCards] = useState(() => new Map(initialQueue.map((c) => [c.id, c])));
  const [queue, setQueue] = useState<QueueItem[]>(() => initialQueue.map((c) => ({ id: c.id, availableAt: 0 })));
  const [currentId, setCurrentId] = useState<string | null>(initialQueue[0]?.id ?? null);
  const [flipped, setFlipped] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [ended, setEnded] = useState<"complete" | "early" | null>(initialQueue.length ? null : "complete");
  const [outlook, setOutlook] = useState(initialOutlook);
  const [editing, setEditing] = useState(false);
  const [help, setHelp] = useState(false);
  const [menu, setMenu] = useState(false);
  const [autoRead, setAutoRead] = useState(false);
  const [announce, setAnnounce] = useState("");
  const [pending, setPending] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [startedAt] = useState(() => Date.now());
  const opChain = useRef<Promise<void>>(Promise.resolve());
  /** When the last grade landed: "Show answer" appears under the finger, so a double tap mustn't flip the next card. */
  const gradedAt = useRef(-Infinity);
  const showRef = useRef<HTMLButtonElement>(null);
  const goodRef = useRef<HTMLButtonElement>(null);
  const reduced = useReducedMotion();
  const { play, focusMode } = useSound();
  const calm = !!reduced || focusMode;
  const toast = useActionToast();
  const subjectsById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const card = currentId ? cards.get(currentId) ?? null : null;
  const cardSubject = card ? subjectsById.get(card.subjectId) ?? subject : subject;
  const homeHref = subject ? `/subjects/${subject.id}` : "/subjects";
  const homeLabel = subject ? `Back to ${subject.name}` : "Back to your subjects";
  const owner = card ? `review:${card.id}` : "review";

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setAutoRead(readPrefs().autoReadCards); }, []);
  // Interval labels use the time the card is shown.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setNow(Date.now()); }, [currentId, ended]);

  const doneGrades = history.length;
  const reviewedCards = new Set(history.map((h) => h.cardId)).size;
  const toGo = queue.length;
  const stats = {
    remembered: history.filter((h) => h.rating >= 3).length,
    tricky: history.filter((h) => h.rating === 2).length,
    again: history.filter((h) => h.rating === 1).length,
  };

  // ---- sending grades, in order, with retries --------------------------------
  const runOp = useCallback((op: Op) => {
    setPending((n) => n + 1);
    opChain.current = opChain.current.then(async () => {
      for (let attempt = 0; ; attempt++) {
        const res = await (op.kind === "grade" ? reviewCard({ flashcardId: op.cardId, rating: op.rating, clientKey: op.key }) : undoReview(op.cardId, op.key)).catch(() => null);
        if (res) {
          // Deleted elsewhere / nothing to undo: skip silently.
          if (res.ok) setCards((m) => { const c = m.get(op.cardId); if (!c) return m; const n = new Map(m); n.set(op.cardId, { ...c, srs: res.srs }); return n; });
          break;
        }
        if (attempt === 0) toast.show("Couldn't save that answer. Trying again…", undefined, 4000);
        if (attempt >= 3) {
          toast.show("You're offline. Answers will save when you're back.", undefined, 8000);
          await new Promise<void>((r) => {
            const on = () => { window.removeEventListener("online", on); r(); };
            window.addEventListener("online", on);
            setTimeout(on, 30_000);
          });
        } else {
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
        }
      }
      setPending((n) => n - 1);
    });
  }, [toast]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (pending > 0) e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [pending]);

  // ---- end of session --------------------------------------------------------
  useEffect(() => {
    if (!ended || (ended === "complete" && history.length === 0 && initialOutlook)) return;
    speech.stopIf(owner);
    let alive = true;
    // Wait for the last grades to land so "Next up" counts them.
    void opChain.current.then(() => sessionOutlook(subject?.id ?? null)).then((r) => { if (alive && r.ok) setOutlook(r.outlook); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ended]);

  // ---- actions ---------------------------------------------------------------
  const speakSide = useCallback((c: DeckCard, side: "front" | "back") => {
    speech.start(`review:${c.id}`, segmentsOf([{ part: side, text: side === "front" ? c.front : c.back }]));
  }, []);

  const flip = useCallback(() => {
    if (!card || flipped) return;
    play("flip");
    setFlipped(true);
    setAnnounce(`Answer: ${short(card.back)}`);
    if (autoRead) setTimeout(() => speakSide(card, "back"), 150);
    else speech.stopIf(owner);
    requestAnimationFrame(() => goodRef.current?.focus());
  }, [card, flipped, play, autoRead, speakSide, owner]);

  /** Taps only (keyboard clicks have detail 0): ignore the second half of a double tap on a grade. */
  const tapFlip = (e: React.MouseEvent) => { if (e.detail > 0 && performance.now() - gradedAt.current < 400) return; flip(); };

  const grade = useCallback((rating: Rating) => {
    if (!card || !flipped) return;
    gradedAt.current = performance.now();
    const t = new Date();
    const next = gradeCard(card.srs, rating, t);
    const nextQueue = requeue(queue, card.id, next.dueAt, t);
    const last = nextQueue.length === 0;
    play(last ? "cheer" : "click");
    speech.stopIf(owner);
    const key = crypto.randomUUID();
    setHistory((h) => [...h, { key, cardId: card.id, rating, prevSrs: card.srs, prevQueue: queue }]);
    setCards((m) => new Map(m).set(card.id, { ...card, srs: next }));
    setQueue(nextQueue);
    runOp({ kind: "grade", key, cardId: card.id, rating });
    setFlipped(false);
    if (last) { setCurrentId(null); setEnded("complete"); setAnnounce(`Session complete. You reviewed ${new Set([...history.map((h) => h.cardId), card.id]).size} cards.`); return; }
    const i = pickNext(nextQueue, t);
    const nextCard = cards.get(nextQueue[i].id)!;
    setCurrentId(nextCard.id);
    setAnnounce(`Card ${history.length + 2}. Question: ${short(nextCard.front)}`);
    if (autoRead) setTimeout(() => speakSide(nextCard, "front"), 300);
    requestAnimationFrame(() => showRef.current?.focus());
  }, [card, flipped, queue, history, cards, play, runOp, autoRead, speakSide, owner]);

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    play("click");
    speech.stopIf(owner);
    setHistory((h) => h.slice(0, -1));
    setQueue(last.prevQueue);
    setCards((m) => { const c = m.get(last.cardId)!; return new Map(m).set(last.cardId, { ...c, srs: last.prevSrs }); });
    setCurrentId(last.cardId);
    setFlipped(false);
    setEnded(null);
    runOp({ kind: "undo", key: last.key, cardId: last.cardId });
    setAnnounce(`Undone. Question: ${short(cards.get(last.cardId)!.front)}`);
    requestAnimationFrame(() => showRef.current?.focus());
  }, [history, play, runOp, cards, owner]);

  const end = useCallback(() => { play("click"); speech.stopIf(owner); setEnded(doneGrades > 0 || toGo > 0 ? "early" : "complete"); }, [play, doneGrades, toGo, owner]);

  // ---- keyboard ----------------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (t.closest("input, textarea, select, [contenteditable]") || document.querySelector("dialog[open]")) return;
      if (ended) return;
      const k = e.key;
      if ((k === " " || k === "Enter") && !flipped) {
        if (t.closest("button, a")) return; // the focused control handles it
        e.preventDefault();
        flip();
      } else if (["1", "2", "3", "4"].includes(k) && flipped) {
        e.preventDefault();
        grade(Number(k) as Rating);
      } else if (k === "u" || k === "U") undo();
      else if ((k === "r" || k === "R") && card) { play("click", { duringSpeech: true }); speakSide(card, flipped ? "back" : "front"); }
      else if ((k === "e" || k === "E") && card) { play("click"); setEditing(true); }
      else if (k === "Escape") end();
      else if (k === "?") { play("click"); setHelp(true); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ended, flipped, flip, grade, undo, end, card, play, speakSide]);

  useEffect(() => () => speech.stopIf(owner), [owner]);

  const intervals = card ? previewIntervals(card.srs, new Date(now)) : null;
  const colours = [...new Set(history.map((h) => SUBJECT_COLOURS[subjectsById.get(cards.get(h.cardId)?.subjectId ?? "")?.colour ?? subject?.colour ?? "sun"]))];

  // ---- render ------------------------------------------------------------------
  const topBar = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {!ended && <Button variant="ghost" size="sm" onClick={end}>✕ End</Button>}
        {subject ? <SubjectChip name={subject.name} emoji={subject.emoji} colour={subject.colour} /> : <span className="chip">All subjects</span>}
        <div className="ml-auto flex items-center gap-2">
          {!ended && <span className="text-sm font-bold" data-testid="progress-text">{doneGrades} done · {toGo} to go</span>}
          {!ended && (
            <div className="relative">
              <Button variant="ghost" size="sm" className="icon-btn" aria-label="More options" aria-expanded={menu} aria-haspopup="true" onClick={() => setMenu(!menu)}>⋯</Button>
              {menu && (
                <div className="sticker absolute right-0 top-full z-30 mt-2 flex w-64 flex-col gap-2 p-3">
                  <label className="flex items-center gap-2 font-bold">
                    <input type="checkbox" className="h-5 w-5 accent-[var(--ink)]" checked={autoRead}
                      onChange={(e) => { play("click", { duringSpeech: true }); setAutoRead(e.target.checked); writePrefs({ autoReadCards: e.target.checked }); }} />
                    Read cards automatically
                  </label>
                  <Button size="sm" variant="ghost" onClick={() => { setMenu(false); setHelp(true); }}>Keyboard shortcuts</Button>
                </div>
              )}
            </div>
          )}
          {!ended && <Button variant="ghost" size="sm" className="hidden lg:inline-flex" onClick={() => setHelp(true)}>Keyboard shortcuts</Button>}
        </div>
      </div>
      {!ended && (
        <div
          role="progressbar" aria-label="Session progress" aria-valuemin={0} aria-valuemax={doneGrades + toGo} aria-valuenow={doneGrades}
          aria-valuetext={`${doneGrades} of ${doneGrades + toGo} cards done`}
          className="h-[6px] w-full overflow-hidden rounded-full border-2 border-ink bg-card"
        >
          <div className="h-full bg-highlight transition-[width] duration-300" style={{ width: `${(doneGrades / Math.max(1, doneGrades + toGo)) * 100}%` }} />
        </div>
      )}
    </div>
  );

  if (ended) {
    const line = outlookLine(outlook);
    const nextSubject = outlook?.others[0];
    if (ended === "complete" && doneGrades === 0) {
      return (
        <div className="flex flex-col gap-6" style={subject ? subjectStyle(subject.colour) : undefined}>
          {topBar}
          <div className="sticker relative mx-auto mt-6 flex max-w-lg flex-col items-center gap-3 p-8 text-center">
            <span className="tape" aria-hidden="true" />
            {totalCards === 0 ? (
              <>
                <h1 className="font-display text-3xl">No flashcards yet</h1>
                {subject && <Link href={`/subjects/${subject.id}/flashcards`} className="btn btn-primary">Make flashcards</Link>}
                {!subject && <Link href="/subjects" className="btn btn-primary">Back to your subjects</Link>}
              </>
            ) : (
              <>
                <h1 className="font-display text-3xl">All caught up!</h1>
                <p className="text-ink-soft">{subject ? "Nothing to review right now." : "Nothing due in any subject."} {line?.replace("Next up:", "Next:")}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {subject && <Link href={`/subjects/${subject.id}/flashcards`} className="btn">Make more flashcards</Link>}
                  <Link href={homeHref} className="btn btn-primary">{homeLabel}</Link>
                </div>
              </>
            )}
          </div>
        </div>
      );
    }
    if (ended === "early") {
      return (
        <div className="flex flex-col gap-6" style={subject ? subjectStyle(subject.colour) : undefined}>
          {topBar}
          <div className="sticker mx-auto mt-6 flex max-w-lg flex-col items-center gap-3 p-8 text-center" role="status">
            <h1 className="font-display text-3xl">Saved!</h1>
            <p>You reviewed {reviewedCards} {reviewedCards === 1 ? "card" : "cards"}. {toGo} {toGo === 1 ? "is" : "are"} still waiting.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {toGo > 0 && <Button onClick={() => { setEnded(null); const i = pickNext(queue, new Date()); setCurrentId(queue[i]?.id ?? null); }}>Keep going</Button>}
              <Link href={homeHref} className="btn btn-primary">{homeLabel}</Link>
            </div>
          </div>
        </div>
      );
    }
    const minutes = Math.max(1, Math.round((now - startedAt) / 60_000));
    const signOff = stats.again / Math.max(1, doneGrades) >= 0.3 ? "Tough deck. That's exactly how it sticks." : stats.remembered / Math.max(1, doneGrades) >= 0.7 ? "You know this stuff!" : "Nice work. See you next time.";
    return (
      <div className="flex flex-col gap-6" style={subject ? subjectStyle(subject.colour) : undefined}>
        {topBar}
        {calm ? (
          <span aria-hidden="true" className="mx-auto text-6xl">⭐</span>
        ) : (
          <Confetti colours={[...colours, "var(--highlight)"]} />
        )}
        <section aria-labelledby="done-h" className="sticker relative mx-auto mt-4 flex w-full max-w-lg flex-col items-center gap-4 p-6 text-center sm:p-8">
          <span className="tape" aria-hidden="true" />
          <h1 id="done-h" className="font-display text-4xl">Deck done!</h1>
          <p>You reviewed {reviewedCards} {reviewedCards === 1 ? "card" : "cards"} in {minutes} {minutes === 1 ? "minute" : "minutes"}.</p>
          <ul className="grid w-full grid-cols-1 gap-3 sm:grid-cols-3">
            <li className="sticker-flat p-3"><span className="block text-2xl font-bold">{stats.remembered}</span>Remembered</li>
            <li className="sticker-flat p-3"><span className="block text-2xl font-bold">{stats.tricky}</span>Tricky</li>
            <li className="sticker-flat p-3"><span className="block text-2xl font-bold">{stats.again}</span>Again</li>
          </ul>
          {line && <p data-testid="outlook">{line}</p>}
          <p className="font-bold">{signOff}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={homeHref} className="btn btn-primary">{homeLabel}</Link>
            {nextSubject && <Link href={`/subjects/${nextSubject.id}/review`} className="btn">Review {nextSubject.name} · {nextSubject.due} due</Link>}
          </div>
        </section>
        <p className="sr-only" aria-live="polite">{announce}</p>
      </div>
    );
  }

  if (!card || !intervals || !cardSubject) return null;
  const subjectColour = cardSubject.colour;

  const faceClass = "flip-face sticker absolute inset-0 flex flex-col gap-3 overflow-y-auto p-5 pt-8 sm:p-8 sm:pt-10";
  const textAlign = (s: string) => (s.length > 120 ? "text-left" : "text-center");

  return (
    <div className="flex flex-col gap-5" style={subjectStyle(subjectColour)}>
      {topBar}
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={`${card.id}-${doneGrades}`}
          className="relative mx-auto w-full sm:w-[560px] lg:w-[640px]"
          initial={calm ? { opacity: 0 } : { opacity: 0, y: 8 }}
          animate={calm ? { opacity: 1, transition: { duration: 0.15 } } : { opacity: 1, y: 0, transition: { type: "spring", duration: 0.25, bounce: 0.3 } }}
          exit={calm ? { opacity: 0, transition: { duration: 0.15 } } : { opacity: 0, x: -24, transition: { duration: 0.2 } }}
        >
          {toGo > 1 && (
            <>
              <span className="stack-edge" aria-hidden="true" style={{ rotate: calm ? "0deg" : "-2deg", translate: "4px 6px" }} />
              <span className="stack-edge" aria-hidden="true" style={{ rotate: calm ? "0deg" : "1.5deg", translate: "-3px 4px" }} />
            </>
          )}
          <section
            aria-roledescription="flashcard" aria-label={`Card ${doneGrades + 1}`}
            className="flip-scene relative min-h-[320px] sm:min-h-[360px] lg:min-h-[400px]"
          >
            <motion.div
              className="relative h-full min-h-[inherit]"
              style={{ transformStyle: "preserve-3d" }}
              animate={calm ? undefined : { rotateY: flipped ? 180 : 0 }}
              transition={{ duration: 0.42, ease: [0.3, 1.3, 0.5, 1] }}
            >
              {/* front */}
              <motion.div
                className={faceClass} style={{ transform: "rotateY(0deg)" }}
                animate={calm ? { opacity: flipped ? 0 : 1 } : undefined} transition={{ duration: 0.15 }}
                inert={flipped} aria-hidden={flipped}
                onClick={(e) => { if (!(e.target as HTMLElement).closest("button, a")) tapFlip(e); }}
              >
                <span className="washi" aria-hidden="true" />
                <span className="absolute left-3 top-1 text-xl" role="img" aria-label={cardSubject.name}>{cardSubject.emoji}</span>
                <div className="flex flex-1 items-center justify-center">
                  <p className={`max-w-[65ch] whitespace-pre-wrap text-xl font-bold ${textAlign(card.front)}`}><SpokenText owner={owner} part="front" text={card.front} /></p>
                </div>
                <p className="hint text-center">Tap or press Space to flip</p>
              </motion.div>
              {/* back */}
              <motion.div
                className={faceClass} style={{ transform: calm ? "none" : "rotateY(180deg)" }}
                initial={false}
                animate={calm ? { opacity: flipped ? 1 : 0 } : undefined} transition={{ duration: 0.15 }}
                inert={!flipped} aria-hidden={!flipped}
              >
                <span className="washi" aria-hidden="true" />
                <div className="flex flex-1 items-center justify-center">
                  <p className={`max-w-[65ch] whitespace-pre-wrap text-lg ${textAlign(card.back)}`}><SpokenText owner={owner} part="back" text={card.back} /></p>
                </div>
                {card.source.kind !== "manual" && (
                  <div className="border-t-2 border-dashed border-[var(--rule)] pt-3">
                    <SourceQuote quote={card.quote} source={card.source} newTab />
                  </div>
                )}
              </motion.div>
            </motion.div>
            <div className="absolute right-2 top-2 z-10 flex gap-1">
              <ReadAloudButton owner={owner} label={flipped ? "answer" : "question"} parts={() => [{ part: flipped ? "back" : "front", text: flipped ? card.back : card.front }]} />
              <Button size="sm" className="icon-btn" aria-label="Edit card" title="Edit card (E)" onClick={() => setEditing(true)}><span aria-hidden="true">✏️</span></Button>
            </div>
          </section>
        </motion.div>
      </AnimatePresence>

      <div className="mx-auto flex w-full flex-col gap-2 sm:w-[560px] lg:w-[640px]">
        {!flipped ? (
          <Button ref={showRef} variant="primary" sound={null} className="min-h-[64px] w-full text-lg" aria-label={`Show answer. Question: ${short(card.front)}`} onClick={tapFlip}>
            Show answer
          </Button>
        ) : (
          <div role="group" aria-label="How well did you remember it?" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {RATINGS.map((r) => (
              <button
                key={r} ref={r === 3 ? goodRef : undefined} type="button"
                className={`btn grade grade-${r}`}
                aria-label={`${RATING_LABEL[r]}, next review ${formatInterval(intervals[r])}`}
                onClick={() => grade(r)}
              >
                <span className="keycap" aria-hidden="true">{r}</span>
                <span className="font-bold">{RATING_LABEL[r]}</span>
                <span className="text-sm font-normal">{formatInterval(intervals[r])}</span>
              </button>
            ))}
          </div>
        )}
        {history.length > 0 && <Button variant="ghost" size="sm" className="mx-auto" onClick={undo} sound={null}>Undo</Button>}
      </div>

      <p className="sr-only" aria-live="polite">{announce}</p>

      <Dialog open={editing} onClose={() => setEditing(false)} title="Edit card">
        {editing && (
          <CardEditor
            initial={card}
            onCancel={() => setEditing(false)}
            onSave={async (front, back) => {
              const r = await updateCard({ id: card.id, front, back });
              if (!r.ok) return r.error;
              setCards((m) => new Map(m).set(card.id, { ...r.card, srs: card.srs }));
              setEditing(false);
              play("pop");
              return null;
            }}
          />
        )}
      </Dialog>
      <Dialog open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts">
        <table className="w-full text-left">
          <tbody>
            {[["Space or Enter", "Flip the card"], ["1 / 2 / 3 / 4", "Again / Hard / Good / Easy"], ["U", "Undo last grade"], ["R", "Read the visible side aloud"], ["E", "Edit this card"], ["Esc", "End session"], ["?", "Show these shortcuts"]].map(([k, v]) => (
              <tr key={k} className="border-b border-[var(--rule)]"><th scope="row" className="py-2 pr-4"><kbd className="chip">{k}</kbd></th><td className="py-2">{v}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="flex justify-end"><Button onClick={() => setHelp(false)}>Close</Button></div>
      </Dialog>
      {toast.node}
    </div>
  );
}
