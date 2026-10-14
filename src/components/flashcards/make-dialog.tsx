"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { MAX_CARD_PAGES } from "@/lib/validation";
import { timeAgo } from "@/lib/time";
import type { Quota } from "@/lib/limits/ai";
import { deleteCard, loadMakeOptions, makeFlashcards, restoreCard, updateCard, type MakeOptions, type MakeResult } from "@/server/actions/flashcards";
import type { DeckCard } from "@/server/cards";
import { useSound } from "../sound-provider";
import { useActionToast } from "../ui/action-toast";
import { Button } from "../ui/button";
import { QuotaChip } from "../ui/quota-chip";
import { CardEditor } from "./card-editor";

export type MakePreset = { type: "note" | "file"; id: string };
type Phase =
  | { kind: "loading" }
  | { kind: "choose" }
  | { kind: "generating" }
  | { kind: "result"; cards: DeckCard[]; requested: number }
  | { kind: "message"; result: Exclude<MakeResult, { status: "made" }> }
  | { kind: "error"; text: string };

const LINES = ["Reading your notes…", "Picking out the key ideas…", "Writing questions…", "Nearly there…"];

/**
 * "Make flashcards" (flashcards.md): choose a source → generating → result, with the
 * friendly messages for limits, short notes, cache hits and failures.
 */
export function MakeFlashcardsDialog({ subjectId, subjectName, open, onClose, preset, onMade, onAddByHand, onCardChange }: {
  subjectId: string;
  subjectName: string;
  open: boolean;
  onClose: () => void;
  preset?: MakePreset | null;
  onMade?: (cards: DeckCard[], quota: Quota) => void;
  onAddByHand?: () => void;
  /** A new card was edited (card) or removed (null) in the result list. */
  onCardChange?: (id: string, card: DeckCard | null) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [opts, setOpts] = useState<MakeOptions | null>(null);
  const [choice, setChoice] = useState<MakePreset | null>(null);
  const [showList, setShowList] = useState(true);
  const [count, setCount] = useState<10 | 15 | 20>(10);
  const [pages, setPages] = useState({ from: 1, to: MAX_CARD_PAGES });
  const [line, setLine] = useState(0);
  const openRef = useRef(open);
  const { play } = useSound();
  const toast = useActionToast();
  const router = useRouter();
  const uid = useId();

  useEffect(() => { openRef.current = open; }, [open]);

  // Native <dialog>: focus trap, Esc and inert background for free.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // Load sources and quota each time it opens (unless a generation is still running).
  const presetKey = preset ? `${preset.type}:${preset.id}` : "";
  useEffect(() => {
    if (!open) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase((p) => (p.kind === "generating" ? p : { kind: "loading" }));
    void loadMakeOptions(subjectId).then((res) => {
      if (!alive) return;
      if (!res.ok) { setPhase({ kind: "error", text: res.error }); return; }
      setOpts(res);
      const [type, id] = presetKey.split(":");
      setChoice(presetKey ? { type: type as MakePreset["type"], id } : null);
      setShowList(!presetKey);
      setPhase((p) => {
        if (p.kind === "generating") return p;
        if (res.quota.left === 0) { play("boop"); return { kind: "message", result: { status: "limit", quota: res.quota } }; }
        return { kind: "choose" };
      });
    });
    return () => { alive = false; };
  }, [open, subjectId, presetKey, play]);

  useEffect(() => {
    if (phase.kind !== "generating") return;
    const t = setInterval(() => setLine((l) => (l + 1) % LINES.length), 3000);
    return () => clearInterval(t);
  }, [phase.kind]);

  useEffect(() => { if (phase.kind === "result" || phase.kind === "message") titleRef.current?.focus(); }, [phase.kind]);

  const selectedFile = choice?.type === "file" ? opts?.files.find((f) => f.id === choice.id) : undefined;
  const bigFile = (selectedFile?.pageCount ?? 0) > MAX_CARD_PAGES;
  const quota = phase.kind === "message" ? phase.result.quota : opts?.quota;

  async function generate() {
    if (!choice) return;
    setPhase({ kind: "generating" });
    setLine(0);
    const source = choice.type === "note"
      ? { type: "note" as const, id: choice.id }
      : { type: "file" as const, id: choice.id, fromPage: bigFile ? pages.from : 1, toPage: bigFile ? pages.to : Math.max(1, selectedFile?.pageCount ?? 1) };
    const res = await makeFlashcards({ subjectId, source, count }).catch(() => null);
    if (!res || !res.ok) {
      play("boop");
      setPhase(res && !res.ok ? { kind: "error", text: res.error } : { kind: "message", result: { status: "failed", quota: opts!.quota } });
      return;
    }
    const r = res.result;
    setOpts((o) => (o ? { ...o, quota: r.quota } : o));
    if (r.status === "made") {
      onMade?.(r.cards, r.quota);
      setPhase({ kind: "result", cards: r.cards, requested: r.requested });
      if (openRef.current) play("pop");
      else toast.show(`${r.cards.length} new ${subjectName} cards are ready`, { label: "See cards", href: `/subjects/${subjectId}/flashcards` });
      router.refresh();
      return;
    }
    if (r.status !== "already") play("boop");
    setPhase({ kind: "message", result: r });
  }

  const close = () => {
    onClose();
    // A finished result resets for next time; a running generation keeps going in the background.
    if (phase.kind !== "generating") setPhase({ kind: "loading" });
  };

  const sourceRow = (kind: "note" | "file", id: string, title: string, meta: string, disabled: string | null) => (
    <li key={id}>
      <label className={`flex min-h-11 items-center gap-3 rounded-md border-2 border-transparent p-2 ${disabled ? "opacity-60" : "cursor-pointer hover:border-ink"}`}>
        <input
          type="radio" name={`${uid}-src`} className="h-5 w-5 accent-[var(--ink)]" disabled={!!disabled}
          checked={choice?.type === kind && choice.id === id}
          onChange={() => { play("click"); setChoice({ type: kind, id }); }}
        />
        <span aria-hidden="true">{kind === "note" ? "📝" : "📄"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{title}</span>
          <span className="hint">{disabled ?? meta}</span>
        </span>
      </label>
    </li>
  );

  let body: React.ReactNode;
  let title = "Make flashcards";
  if (phase.kind === "loading") {
    body = <div className="flex flex-col gap-2" aria-busy="true"><div className="skeleton h-10" /><div className="skeleton h-10" /><div className="skeleton h-10" /></div>;
  } else if (phase.kind === "error") {
    body = (<><p role="alert" className="error-text">{phase.text}</p><div className="flex justify-end"><Button onClick={close}>Close</Button></div></>);
  } else if (phase.kind === "choose" && opts) {
    const chosenTitle = choice?.type === "note" ? opts.notes.find((n) => n.id === choice.id)?.title : opts.files.find((f) => f.id === choice?.id)?.name;
    body = (
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void generate(); }}>
        {showList ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="label mb-1">Choose a source</legend>
            {opts.notes.length === 0 && opts.files.length === 0 && <p className="hint">Add a note or a lecture file first, then make cards from it.</p>}
            {opts.notes.length > 0 && (
              <div>
                <h3 className="font-bold">Notes</h3>
                <ul className="flex flex-col">{opts.notes.map((n) => sourceRow("note", n.id, n.title, `updated ${timeAgo(n.updatedAt)}`, null))}</ul>
              </div>
            )}
            {opts.files.length > 0 && (
              <div>
                <h3 className="font-bold">Lecture files</h3>
                <ul className="flex flex-col">
                  {opts.files.map((f) => sourceRow("file", f.id, f.name, `${f.pageCount ?? 0} ${f.kind === "pptx" ? "slides" : "pages"}`,
                    f.status === "ready" ? null : f.status === "pending" || f.status === "reading" ? "Still reading text…" : "No text found"))}
                </ul>
              </div>
            )}
          </fieldset>
        ) : (
          <p>
            From <strong>{chosenTitle ?? "this source"}</strong>.{" "}
            <button type="button" className="font-bold underline underline-offset-2" onClick={() => { play("click"); setShowList(true); }}>Change source</button>
          </p>
        )}
        {bigFile && (
          <fieldset className="flex flex-col gap-1">
            <legend className="label">Pages</legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`${uid}-from`}>First page</label>
              <input id={`${uid}-from`} type="number" className="input w-24" min={1} max={selectedFile?.pageCount ?? 1} value={pages.from}
                onChange={(e) => { const v = Math.max(1, Number(e.target.value) || 1); setPages({ from: v, to: Math.min(Math.max(v, pages.to), v + MAX_CARD_PAGES - 1) }); }} />
              <span>to</span>
              <label className="sr-only" htmlFor={`${uid}-to`}>Last page</label>
              <input id={`${uid}-to`} type="number" className="input w-24" min={pages.from} max={Math.min(selectedFile?.pageCount ?? 1, pages.from + MAX_CARD_PAGES - 1)} value={pages.to}
                onChange={(e) => setPages({ ...pages, to: Math.min(Math.max(pages.from, Number(e.target.value) || pages.from), pages.from + MAX_CARD_PAGES - 1) })} />
            </div>
            <p className="hint">Big file! Up to {MAX_CARD_PAGES} pages at a time.</p>
          </fieldset>
        )}
        <fieldset className="flex flex-col gap-1">
          <legend className="label">Number of cards</legend>
          <div className="seg w-fit">
            {([10, 15, 20] as const).map((n) => (
              <label key={n}>
                <input type="radio" className="sr-only" name={`${uid}-count`} checked={count === n} onChange={() => { play("click"); setCount(n); }} />
                About {n}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-2">
          <QuotaChip quota={opts.quota} />
          <span className="hint">Making cards from the same text again is free.</span>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!choice}>Make flashcards</Button>
        </div>
      </form>
    );
  } else if (phase.kind === "generating") {
    body = (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="relative h-28 w-40" aria-hidden="true">
          {[-3, 2, -1].map((r, i) => (
            <span key={i} className="sticker shuffle absolute inset-0" style={{ ["--r" as string]: `${r}deg`, animationDelay: `${i * 0.4}s`, top: i * 6, left: i * 6 }} />
          ))}
        </div>
        <p aria-hidden="true" className="font-bold">{LINES[line]}</p>
        <p className="sr-only" role="status">Making flashcards. This takes about 15 seconds.</p>
        <p className="hint">You can close this. We&apos;ll tell you when they&apos;re ready.</p>
        <Button variant="ghost" onClick={close}>Close</Button>
      </div>
    );
  } else if (phase.kind === "result") {
    title = `${phase.cards.length} new ${phase.cards.length === 1 ? "card" : "cards"}! ✨`;
    body = (
      <div className="flex flex-col gap-3">
        {phase.cards.length < phase.requested && <p className="hint">Your notes had enough for {phase.cards.length} {phase.cards.length === 1 ? "card" : "cards"}.</p>}
        <ul className="flex max-h-[45dvh] flex-col gap-2 overflow-y-auto pr-1" aria-label="New cards">
          {phase.cards.map((c) => <ResultRow key={c.id} card={c} onChange={onCardChange} />)}
        </ul>
        {quota && <div><QuotaChip quota={quota} /></div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={close}>Done</Button>
          <Link href={`/subjects/${subjectId}/review`} className="btn btn-primary" onClick={() => play("click")}>Start reviewing</Link>
        </div>
      </div>
    );
  } else if (phase.kind === "message") {
    const r = phase.result;
    const msg = {
      too_short: { emoji: "✏️", text: r.status === "too_short" && r.sourceType === "file" ? "This file doesn't have enough text for flashcards." : "This note is a bit short for flashcards. Add a paragraph or two and try again." },
      limit: { emoji: "🌙", text: `You've made all ${r.quota.limit} sets of flashcards for today. More tomorrow! You can still add cards by hand.` },
      allowance: { emoji: "🌙", text: "Today's free AI allowance is used up. Try again tomorrow. Your notes and cards are safe." },
      already: { emoji: "📚", text: "You already made cards from this version of the note. Change the note or pick another source." },
      failed: { emoji: "🌀", text: "The card maker got muddled. Try again. This one didn't use up a go." },
    }[r.status];
    body = (
      <div className="flex flex-col gap-4">
        <div className="sticker-flat flex items-start gap-3 p-4">
          <span className="text-3xl" aria-hidden="true">{msg.emoji}</span>
          <p>{msg.text}</p>
        </div>
        {r.status !== "already" && <div><QuotaChip quota={r.quota} /></div>}
        <div className="flex flex-wrap justify-end gap-2">
          {r.status === "too_short" && <Button variant="primary" onClick={() => { setShowList(true); setPhase({ kind: "choose" }); }}>Pick another source</Button>}
          {r.status === "limit" && onAddByHand && <Button variant="primary" onClick={() => { close(); onAddByHand(); }}>Add a card by hand</Button>}
          {r.status === "already" && (
            <>
              <Button onClick={() => { setShowList(true); setPhase({ kind: "choose" }); }}>Pick another source</Button>
              <Link href={`/subjects/${subjectId}/flashcards`} className="btn btn-primary" onClick={() => { play("click"); close(); }}>Show those cards</Link>
            </>
          )}
          {r.status === "failed" && <Button variant="primary" onClick={() => void generate()} disabled={!choice}>Try again</Button>}
          {(r.status === "limit" || r.status === "allowance") && <Button onClick={close}>Close</Button>}
        </div>
      </div>
    );
  }

  return (
    <>
      <dialog ref={ref} className="sheet" aria-labelledby={`${uid}-title`} onClose={() => { if (open) close(); }} onCancel={(e) => { e.preventDefault(); close(); }}>
        <div className="flex max-h-[85dvh] flex-col gap-4 overflow-y-auto p-5 sm:p-6">
          <h2 id={`${uid}-title`} ref={titleRef} tabIndex={-1} className="font-display text-2xl outline-none">{title}</h2>
          {body}
        </div>
      </dialog>
      {toast.node}
    </>
  );
}

/** One new card in the result list: Edit inline, Remove with Undo in the row. */
function ResultRow({ card: initial, onChange }: { card: DeckCard; onChange?: (id: string, card: DeckCard | null) => void }) {
  const [card, setCard] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [removed, setRemoved] = useState(false);
  const { play } = useSound();
  if (removed) {
    return (
      <li className="flex items-center justify-between gap-2 rounded-md border-2 border-dashed border-ink p-2">
        <span className="hint">Card removed.</span>
        <Button size="sm" onClick={async () => { const r = await restoreCard(card.id); if (r.ok) { setRemoved(false); onChange?.(card.id, r.card); } else play("boop"); }}>Undo</Button>
      </li>
    );
  }
  return (
    <li className="sticker-flat flex flex-col gap-2 p-3">
      {editing ? (
        <CardEditor
          initial={card}
          onCancel={() => setEditing(false)}
          onSave={async (front, back) => {
            const r = await updateCard({ id: card.id, front, back });
            if (!r.ok) return r.error;
            setCard(r.card);
            onChange?.(card.id, r.card);
            setEditing(false);
            play("pop");
            return null;
          }}
        />
      ) : (
        <>
          <p className="font-bold">{card.front}</p>
          <p>{card.back}</p>
          {card.quote && <p className="quote-block text-sm">{card.quote.split(/(?<=[.!?])\s/)[0]}</p>}
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setEditing(true)} aria-label={`Edit card: ${card.front.slice(0, 40)}`}>Edit</Button>
            <Button size="sm" variant="ghost" sound="tear" aria-label={`Remove card: ${card.front.slice(0, 40)}`}
              onClick={async () => { const r = await deleteCard(card.id); if (r.ok) { setRemoved(true); onChange?.(card.id, null); } }}>Remove</Button>
          </div>
        </>
      )}
    </li>
  );
}
