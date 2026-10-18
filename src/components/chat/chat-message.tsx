"use client";
import Link from "next/link";
import { useState, type ReactNode } from "react";
import { parseContent, plainText, type Inline } from "@/lib/chat/render";
import type { ChatMessageView, CitationView } from "@/server/chat";
import { ReadAloudButton } from "../read-aloud/read-aloud-button";
import { useSound } from "../sound-provider";
import { Button } from "../ui/button";
import { RowMenu } from "../ui/row-menu";

export type ShownMessage = ChatMessageView & {
  /** Sending: shown at 60 % until saved. */
  pending?: boolean;
  /** Couldn't get an answer: the inline error and "Try again". */
  failed?: string;
  clientKey?: string;
};

type OpenCitation = (c: CitationView, el: HTMLElement) => void;

/** Text of an answer in the safe subset: React text nodes, bold and citation chips only. */
export function AnswerText({ content, citations, onCite, openN }: { content: string; citations: CitationView[]; onCite: OpenCitation; openN: number | null }) {
  const { play } = useSound();
  const byN = new Map(citations.map((c) => [c.n, c]));
  const inline = (parts: Inline[], key: string): ReactNode[] => parts.map((p, i) => {
    if (p.t === "text") return <span key={`${key}-${i}`}>{p.v}</span>;
    if (p.t === "bold") return <strong key={`${key}-${i}`}>{p.v}</strong>;
    const c = byN.get(p.n);
    if (!c) return null;
    return (
      <button
        key={`${key}-${i}`} type="button" className="cite-chip" aria-label={`Source ${c.n}: ${c.label}`} aria-haspopup="dialog" aria-expanded={openN === c.n}
        onClick={(e) => { play("click"); onCite(c, e.currentTarget); }}
      >
        {c.n}
      </button>
    );
  });
  return (
    <div className="answer-text">
      {parseContent(content).map((b, i) =>
        b.t === "p" ? <p key={i}>{inline(b.inlines, `p${i}`)}</p>
          : b.t === "ul" ? <ul key={i}>{b.items.map((it, j) => <li key={j}>{inline(it, `u${i}-${j}`)}</li>)}</ul>
          : <ol key={i}>{b.items.map((it, j) => <li key={j}>{inline(it, `o${i}-${j}`)}</li>)}</ol>)}
    </div>
  );
}

/** "From Lecture 3.pdf, page 12" / "From Cell structure (note)" / deleted. */
function SourceRow({ c }: { c: CitationView }) {
  const { play } = useSound();
  const [quote, setQuote] = useState(false);
  const where = c.kind === "note" ? <>From <strong>{c.title}</strong> (note)</>
    : <>From <strong>{c.title}</strong>{c.page ? `, ${c.unit} ${c.page}` : ""}</>;
  return (
    <li className="flex items-start gap-2">
      <span className="cite-num mt-2.5" aria-hidden="true">{c.n}</span>
      {c.href ? (
        <Link href={c.href} className="inline-flex min-h-11 items-center underline underline-offset-2" onClick={() => play("click")}>
          <span><span className="sr-only">Source {c.n}: </span>{where}</span>
        </Link>
      ) : (
        <div className="flex min-h-11 flex-col justify-center gap-1">
          <span className="flex flex-wrap items-center gap-2"><span className="sr-only">Source {c.n}: </span><span>{c.title}</span><span className="chip">Source deleted</span></span>
          <button type="button" className="w-fit min-h-11 font-bold underline underline-offset-2" aria-expanded={quote} onClick={() => { play("click"); setQuote(!quote); }}>
            {quote ? "Hide quote" : "Show quote"}
          </button>
          {quote && <blockquote className="quote-block">{c.quote}</blockquote>}
        </div>
      )}
    </li>
  );
}

export function copyText(m: ChatMessageView, revealed: boolean): string {
  const body = [plainText(m.content), revealed && m.reveal ? `Answer: ${plainText(m.reveal)}` : ""].filter(Boolean).join("\n\n");
  const sources = m.citations.map((c) => `${c.n}. ${c.label}`).join("\n");
  return sources ? `${body}\n\nSources:\n${sources}` : body;
}

export function ChatMessage({ m, emoji, isNew, onCite, openN, onRetry, onCopy, onFeedback, latest }: {
  m: ShownMessage;
  emoji: string;
  isNew: boolean;
  onCite: OpenCitation;
  openN: number | null;
  onRetry: (m: ShownMessage) => void;
  onCopy: (text: string) => void;
  onFeedback: (id: string, f: "wrong" | "not_in_notes" | "too_long") => void;
  latest: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const { play } = useSound();

  if (m.role === "user") {
    return (
      <article aria-label="You asked" className={`flex flex-col items-end gap-1 ${isNew ? "msg-in" : ""}`} data-testid="msg-user">
        <p className="bubble-user" data-pending={m.pending || undefined}>{m.content}</p>
        {m.failed && (
          <div role="alert" className="flex flex-wrap items-center justify-end gap-2 text-sm" data-testid="send-failed">
            <span>{m.failed}</span>
            <Button size="sm" onClick={() => onRetry(m)}>Try again</Button>
          </div>
        )}
      </article>
    );
  }

  if (m.kind === "not_covered") {
    return (
      <article aria-label="Not in your notes" id={latest ? "latest-answer" : undefined} tabIndex={latest ? -1 : undefined}
        className={`answer-row ${isNew ? "answer-pop" : ""}`} data-testid="msg-not-covered">
        <span className="answer-avatar" aria-hidden="true">{emoji}</span>
        <div className="bubble-missing flex flex-col gap-1">
          <p className="flex items-start gap-2 font-bold">
            <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" className="mt-0.5 flex-none">
              <circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" />
            </svg>
            <span>{m.content}</span>
          </p>
          <p>Try asking about something in your notes, or add a note about it.</p>
          {m.citations.length > 0 && (
            <div>
              <p>Closest I found:</p>
              <ul className="flex flex-col">
                {m.citations.map((c) => (
                  <li key={c.n}>
                    {c.href
                      ? <Link href={c.href} className="inline-flex min-h-11 items-center underline underline-offset-2" onClick={() => play("click")}>{c.label}</Link>
                      : <span className="inline-flex min-h-11 items-center">{c.label} <span className="chip ml-2">Source deleted</span></span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </article>
    );
  }

  const speakParts = () => [{ part: "answer", text: plainText(m.content) }, ...(revealed && m.reveal ? [{ part: "reveal", text: plainText(m.reveal), gapBefore: 600 }] : [])];
  return (
    <article aria-label="Answer from your notes" id={latest ? "latest-answer" : undefined} tabIndex={latest ? -1 : undefined}
      className={`answer-row ${isNew ? "answer-pop" : ""}`} data-testid="msg-answer">
      <span className="answer-avatar" aria-hidden="true">{emoji}</span>
      <div className="bubble-answer">
        <AnswerText content={m.content} citations={m.citations} onCite={onCite} openN={openN} />
        {m.reveal && (
          <div className="mt-2">
            <Button size="sm" aria-expanded={revealed} onClick={() => setRevealed(!revealed)}>{revealed ? "Hide answer" : "Show answer"}</Button>
            {revealed && <div className="mt-2 rounded-md border-2 border-dashed border-ink p-2" data-testid="reveal"><AnswerText content={m.reveal} citations={m.citations} onCite={onCite} openN={openN} /></div>}
          </div>
        )}
        {m.citations.length > 0 && (
          <div className="sources">
            <p className="text-sm font-bold">Sources</p>
            <ul className="flex flex-col" data-testid="sources">{m.citations.map((c) => <SourceRow key={c.n} c={c} />)}</ul>
          </div>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <ReadAloudButton owner={`chat-${m.id}`} parts={speakParts} label="this answer" />
          <button type="button" className="btn btn-sm icon-btn min-h-11" aria-label="Copy" title="Copy" onClick={() => { play("click"); onCopy(copyText(m, revealed)); }}>
            <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
              <rect x="8" y="8" width="12" height="12" rx="2" /><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
            </svg>
          </button>
          <RowMenu label="Not right?" text="Not right?" align="left" flip items={[
            { label: "It's wrong", onSelect: () => onFeedback(m.id, "wrong") },
            { label: "It's not in my notes", onSelect: () => onFeedback(m.id, "not_in_notes") },
            { label: "Too long", onSelect: () => onFeedback(m.id, "too_long") },
          ]} />
        </div>
      </div>
    </article>
  );
}

/** Typing indicator: three ink dots, or static text under reduced motion and in focus mode. */
export function Typing({ still }: { still: boolean }) {
  return (
    <div className="answer-row" data-testid="typing">
      <div className="bubble-answer">
        {still ? <span>Looking through your notes…</span> : (
          <>
            <span className="typing-dots" aria-hidden="true"><span /><span /><span /></span>
            <span className="typing-text">Looking through your notes…</span>
          </>
        )}
      </div>
    </div>
  );
}
