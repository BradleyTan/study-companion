"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Quota } from "@/lib/limits/ai";
import { createCard, deleteCard, restoreCard, updateCard } from "@/server/actions/flashcards";
import type { DeckCard, SubjectLite } from "@/server/cards";
import { ReadAloudButton } from "../read-aloud/read-aloud-button";
import { speech } from "../read-aloud/speech";
import { useSound } from "../sound-provider";
import { SubjectChip } from "../subject-chip";
import { useActionToast } from "../ui/action-toast";
import { Button } from "../ui/button";
import { QuotaChip } from "../ui/quota-chip";
import { subjectStyle } from "../ui/subject-style";
import { CardEditor } from "./card-editor";
import { MakeFlashcardsDialog, type MakePreset } from "./make-dialog";
import { SourceQuote } from "./source-quote";

const PAGE = 50;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const sourceKey = (c: DeckCard) => (c.source.kind === "note" || c.source.kind === "file" ? c.source.href.split("?")[0] : null);
const short = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);

export function Deck({ subject, cards: initial, allowanceLeft, quota: initialQuota, hasSources, makePreset }: {
  subject: SubjectLite;
  cards: DeckCard[];
  allowanceLeft: number;
  quota: Quota;
  hasSources: boolean;
  makePreset?: MakePreset | null;
}) {
  const [cards, setCards] = useState(initial);
  const [quota, setQuota] = useState(initialQuota);
  const [shown, setShown] = useState(PAGE);
  const [adding, setAdding] = useState(false);
  const [makeOpen, setMakeOpen] = useState(!!makePreset);
  const [filter, setFilter] = useState("all");
  const [glowId, setGlowId] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLOListElement>(null);
  const { play } = useSound();
  const toast = useActionToast();
  const storeKey = `studynest:deckFilter:${subject.id}`;

  // Remembered filter per subject (localStorage is only readable after mount).
  useEffect(() => {
    try {
      const v = localStorage.getItem(storeKey);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v) setFilter(v);
    } catch {}
  }, [storeKey]);
  useEffect(() => { if (!glowId) return; const t = setTimeout(() => setGlowId(null), 1500); return () => clearTimeout(t); }, [glowId]);

  const counts = useMemo(() => {
    const fresh = cards.filter((c) => c.isNew).length;
    const due = cards.filter((c) => c.isDue).length + Math.min(fresh, allowanceLeft);
    return { total: cards.length, due, fresh };
  }, [cards, allowanceLeft]);

  const sources = useMemo(() => {
    const m = new Map<string, string>();
    cards.forEach((c) => { const k = sourceKey(c); if (k && (c.source.kind === "note" || c.source.kind === "file")) m.set(k, c.source.title); });
    return [...m];
  }, [cards]);

  const visible = cards.filter((c) =>
    filter === "due" ? c.isDue || c.isNew : filter === "new" ? c.isNew : filter.startsWith("src:") ? sourceKey(c) === filter.slice(4) : true);

  const setFilterSaved = (v: string) => {
    setFilter(v);
    try { localStorage.setItem(storeKey, v); } catch {}
  };

  const replace = (id: string, card: DeckCard | null) => setCards((list) => (card ? list.map((c) => (c.id === id ? card : c)) : list.filter((c) => c.id !== id)));

  async function remove(card: DeckCard, index: number) {
    const res = await deleteCard(card.id);
    if (!res.ok) { play("boop"); toast.show("Couldn't delete. Try again."); return; }
    speech.stopIf(`card:${card.id}`);
    setCards((list) => list.filter((c) => c.id !== card.id));
    toast.show("Card deleted", {
      label: "Undo",
      onClick: async () => {
        const r = await restoreCard(card.id);
        if (r.ok) setCards((list) => [...list.slice(0, index), r.card, ...list.slice(index)]);
      },
    });
    // Focus the next card's first action, or "Add a card" when it was the last.
    requestAnimationFrame(() => {
      const next = listRef.current?.querySelectorAll<HTMLElement>("article [data-first-action]")[index];
      (next ?? addRef.current)?.focus();
    });
  }

  const reviewNow = counts.due > 0 ? (
    <Link href={`/subjects/${subject.id}/review`} className="btn btn-primary w-full sm:w-auto" onClick={() => play("click")}>Review now · {counts.due} due</Link>
  ) : (
    <div className="flex w-full flex-col gap-1 sm:w-auto">
      <button type="button" className="btn w-full sm:w-auto" disabled aria-describedby="nothing-due-hint">Nothing due. Practise later</button>
      {cards.length > 0 && <span id="nothing-due-hint" className="hint">Next cards due tomorrow</span>}
    </div>
  );

  return (
    <div className="flex flex-col gap-6" style={subjectStyle(subject.colour)}>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/subjects/${subject.id}`} className="inline-flex min-h-11 items-center font-bold underline-offset-4 hover:underline">← {subject.name}</Link>
          <SubjectChip name={subject.name} emoji={subject.emoji} colour={subject.colour} />
        </div>
        <h1 className="font-display text-4xl">Flashcards</h1>
        <p className="text-ink-soft" data-testid="deck-summary">{plural(counts.total, "card")} · {counts.due} due today · {counts.fresh} new</p>
      </header>

      {(cards.length > 0 || adding) && (
        <div className="flex flex-col flex-wrap items-stretch gap-3 sm:flex-row sm:items-start">
          {reviewNow}
          <div className="flex flex-wrap items-center gap-2">
            <Button className="w-full sm:w-auto" onClick={() => setMakeOpen(true)} aria-describedby="deck-quota">Make flashcards</Button>
            <QuotaChip quota={quota} id="deck-quota" />
          </div>
          <Button ref={addRef} className="w-full sm:w-auto" onClick={() => setAdding(true)} disabled={adding}>Add a card</Button>
        </div>
      )}

      {cards.length > 10 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="deck-filter" className="label">Show:</label>
          <select id="deck-filter" className="input w-auto" value={filter.startsWith("src:") ? "src" : filter}
            onChange={(e) => { play("click"); setFilterSaved(e.target.value === "src" ? `src:${sources[0]?.[0] ?? ""}` : e.target.value); }}>
            <option value="all">All cards</option>
            <option value="due">Due today</option>
            <option value="new">New</option>
            {sources.length > 0 && <option value="src">From one source…</option>}
          </select>
          {filter.startsWith("src:") && (
            <>
              <label htmlFor="deck-filter-src" className="sr-only">Source</label>
              <select id="deck-filter-src" className="input w-auto max-w-full" value={filter.slice(4)} onChange={(e) => setFilterSaved(`src:${e.target.value}`)}>
                {sources.map(([k, title]) => <option key={k} value={k}>{title}</option>)}
              </select>
            </>
          )}
        </div>
      )}

      {adding && (
        <div className="sticker relative mx-auto w-full max-w-[880px] p-4 sm:p-5">
          <span className="washi" aria-hidden="true" />
          <h2 className="sr-only">New card</h2>
          <CardEditor
            onCancel={() => { setAdding(false); requestAnimationFrame(() => addRef.current?.focus()); }}
            onSave={async (front, back) => {
              const r = await createCard({ subjectId: subject.id, front, back });
              if (!r.ok) return r.error;
              setCards((list) => [r.card, ...list]);
              setAdding(false);
              setGlowId(r.card.id);
              play("pop");
              toast.show("Card saved", undefined, 2500);
              return null;
            }}
          />
        </div>
      )}

      {cards.length === 0 && !adding ? (
        <div className="sticker relative mx-auto mt-4 flex max-w-lg flex-col items-center gap-3 p-8 text-center">
          <span className="tape" aria-hidden="true" />
          <p className="font-display text-3xl">No flashcards yet</p>
          {hasSources ? (
            <>
              <p className="text-ink-soft">Make some from your notes in one tap, or write your own.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" onClick={() => setMakeOpen(true)}>Make flashcards</Button>
                <Button ref={addRef} onClick={() => setAdding(true)}>Add a card</Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-ink-soft">Add a note or a lecture file first, then make cards from it.</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Link href={`/subjects/${subject.id}`} className="btn btn-primary">Back to {subject.name}</Link>
                <Button ref={addRef} onClick={() => setAdding(true)}>Add a card</Button>
              </div>
            </>
          )}
        </div>
      ) : visible.length === 0 && cards.length > 0 ? (
        <div className="sticker-flat flex flex-col items-start gap-2 p-5">
          <p>No cards match this filter.</p>
          <Button onClick={() => setFilterSaved("all")}>Show all cards</Button>
        </div>
      ) : (
        <ol ref={listRef} className="mx-auto flex w-full max-w-[880px] flex-col gap-6" aria-label="Cards">
          {visible.slice(0, shown).map((c) => (
            <li key={c.id}>
              <DeckCardItem card={c} glow={glowId === c.id} onChange={replace} notify={(m) => toast.show(m, undefined, 2500)} onDelete={() => remove(c, cards.findIndex((x) => x.id === c.id))} />
            </li>
          ))}
        </ol>
      )}
      {visible.length > shown && (
        <div className="flex justify-center">
          <Button onClick={() => {
            const first = shown;
            setShown(shown + PAGE);
            requestAnimationFrame(() => listRef.current?.querySelectorAll<HTMLElement>("article [data-first-action]")[first]?.focus());
          }}>Show 50 more</Button>
        </div>
      )}

      <MakeFlashcardsDialog
        subjectId={subject.id} subjectName={subject.name} open={makeOpen} preset={makePreset}
        onClose={() => setMakeOpen(false)}
        onMade={(made, q) => { setCards((list) => [...made, ...list.filter((c) => !made.some((m) => m.id === c.id))]); setQuota(q); setGlowId(made[0]?.id ?? null); }}
        onCardChange={replace}
        onAddByHand={() => setAdding(true)}
      />
      {toast.node}
    </div>
  );
}

function DeckCardItem({ card, glow, onChange, onDelete, notify }: { card: DeckCard; glow: boolean; onChange: (id: string, c: DeckCard | null) => void; onDelete: () => void; notify: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [collapsing, setCollapsing] = useState(false);
  const [popped, setPopped] = useState(false);
  const editRef = useRef<HTMLButtonElement>(null);
  const { play } = useSound();
  const headingId = `card-${card.id}`;

  return (
    <article
      aria-labelledby={headingId}
      className={`sticker relative flex flex-col gap-4 p-4 transition-all duration-200 sm:p-5 ${glow ? "glow" : ""} ${popped ? "pop-in" : ""} ${collapsing ? "scale-y-0 opacity-0" : ""}`}
    >
      <span className="washi" aria-hidden="true" />
      {editing ? (
        <>
          <CardEditor
            initial={card}
            onCancel={() => { setEditing(false); requestAnimationFrame(() => editRef.current?.focus()); }}
            onSave={async (front, back) => {
              const r = await updateCard({ id: card.id, front, back });
              if (!r.ok) return r.error === "This card was deleted." ? r.error : "Couldn't save. Try again.";
              onChange(card.id, r.card);
              setEditing(false);
              setPopped(true);
              play("pop");
              notify("Card saved");
              requestAnimationFrame(() => editRef.current?.focus());
              return null;
            }}
          />
          {card.quote && <SourceQuote quote={card.quote} source={card.source} />}
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 sm:gap-6">
            <div className="flex flex-col gap-1">
              <span className="text-sm font-bold text-ink-soft">Front</span>
              <p id={headingId} className="whitespace-pre-wrap text-lg font-bold">{card.front}</p>
            </div>
            <div className="flex flex-col gap-1 border-t-2 border-dashed border-[var(--rule)] pt-3 sm:border-0 sm:pt-0">
              <span className="text-sm font-bold text-ink-soft">Back</span>
              <p className="whitespace-pre-wrap">{card.back}</p>
            </div>
          </div>
          <SourceQuote quote={card.quote} source={card.source} />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {card.edited && <span className="chip">Edited</span>}
              {card.isNew && <span className="chip">New</span>}
              {card.isDue && <span className="chip chip-due">Due</span>}
            </div>
            {confirming ? (
              <div role="group" aria-label="Delete this card?" className="flex flex-wrap items-center gap-2">
                <span className="font-bold">Delete this card?</span>
                <Button size="sm" variant="danger" sound="tear" onClick={() => { setCollapsing(true); setTimeout(onDelete, 200); }}>Delete</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button>
              </div>
            ) : (
              <div className="flex gap-2">
                <ReadAloudButton firstAction owner={`card:${card.id}`} label={`card: ${short(card.front)}`} parts={() => [{ part: "front", text: card.front }, { part: "back", text: card.back, gapBefore: 600 }]} />
                <Button ref={editRef} size="sm" className="icon-btn" aria-label={`Edit card: ${short(card.front)}`} title="Edit card" onClick={() => setEditing(true)}>
                  <span aria-hidden="true">✏️</span>
                </Button>
                <Button size="sm" className="icon-btn" aria-label={`Delete card: ${short(card.front)}`} title="Delete card" onClick={() => setConfirming(true)}>
                  <span aria-hidden="true">🗑️</span>
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </article>
  );
}
