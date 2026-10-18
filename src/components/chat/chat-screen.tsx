"use client";
import Link from "next/link";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { dayKey, dayLabel } from "@/lib/chat/day";
import { plainText } from "@/lib/chat/render";
import type { Quota } from "@/lib/limits/ai";
import { CHAT_QUESTION_MAX } from "@/lib/validation";
import { askQuestion, clearChat, loadOlderChat, sendChatFeedback } from "@/server/actions/chat";
import type { ChatPageData, CitationView, RetrievalMode } from "@/server/chat";
import { speech } from "../read-aloud/speech";
import { useSound } from "../sound-provider";
import { SubjectChip } from "../subject-chip";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { useToast } from "../ui/live-toast";
import { RowMenu } from "../ui/row-menu";
import { subjectStyle } from "../ui/subject-style";
import { ChatMessage, Typing, type ShownMessage } from "./chat-message";
import { CitationPreview } from "./citation-preview";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const FAILED = "Couldn't get an answer. This one didn't use up a question.";
const draftKey = (id: string) => `studynest:chatDraft:${id}`;

function readDraft(id: string): string {
  try { return localStorage.getItem(draftKey(id)) ?? ""; } catch { return ""; }
}
function writeDraft(id: string, text: string) {
  try {
    if (text) localStorage.setItem(draftKey(id), text.slice(0, CHAT_QUESTION_MAX));
    else localStorage.removeItem(draftKey(id));
  } catch {}
}
const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 80;
const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Ask your notes (chat.md). */
export function ChatScreen({ data, tz }: { data: ChatPageData; tz: string }) {
  const { subject } = data;
  const [messages, setMessages] = useState<ShownMessage[]>(data.messages);
  const [hasOlder, setHasOlder] = useState(data.hasOlder);
  const [quota, setQuota] = useState<Quota>(data.quota);
  const [mode, setMode] = useState<RetrievalMode>(data.mode);
  const [limitHit, setLimitHit] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [offline, setOffline] = useState(false);
  const [live, setLive] = useState("");
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const [newChip, setNewChip] = useState(false);
  const [preview, setPreview] = useState<{ c: CitationView; el: HTMLElement; messageId: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [noSources, setNoSources] = useState(data.notes === 0 && data.readyFiles === 0);
  const [coarse, setCoarse] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef<"bottom" | "keep" | null>(null);
  const keepFrom = useRef(0);
  const { play, focusMode } = useSound();
  const toast = useToast();
  const uid = useId();

  // This device's unsent question, online state and pointer type (after mount: browser-only).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraft(readDraft(subject.id));
    setOffline(!navigator.onLine);
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    if (data.messages.length) window.scrollTo(0, document.documentElement.scrollHeight);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, [subject.id, data.messages.length]);

  // "/" focuses the composer when focus isn't in a text field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.closest("input, textarea, select, [contenteditable=true]") || t.isContentEditable)) return;
      if (!textRef.current) return;
      e.preventDefault();
      textRef.current.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Grow the textarea with its text (1–5 lines; CSS caps the height).
  useLayoutEffect(() => {
    const t = textRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = `${t.scrollHeight + 5}px`;
  }, [draft]);

  // After new messages: follow them if the student was at the bottom, else offer the chip.
  useLayoutEffect(() => {
    const how = stick.current;
    stick.current = null;
    if (how === "bottom") window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" });
    else if (how === "keep") window.scrollTo(0, window.scrollY + document.documentElement.scrollHeight - keepFrom.current);
  }, [messages]);
  useEffect(() => {
    if (!newChip) return;
    const onScroll = () => { if (atBottom()) setNewChip(false); };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [newChip]);

  const updateDraft = (text: string) => { setDraft(text); writeDraft(subject.id, text); };
  const outOfGoes = limitHit || quota.left === 0;
  const allowanceOut = !quota.appAllowanceLeft;
  const blocked = outOfGoes || allowanceOut;

  const send = useCallback(async (text: string, clientKey = crypto.randomUUID()) => {
    const question = text.trim();
    if (!question || sending || offline) return;
    play("click");
    const tempId = `tmp-${clientKey}`;
    stick.current = "bottom";
    setMessages((list) => [
      ...list.filter((m) => m.clientKey !== clientKey),
      { id: tempId, role: "user", kind: "question", content: question, citations: [], reveal: null, feedback: null, createdAt: new Date().toISOString(), pending: true, clientKey },
    ]);
    setNewIds((s) => new Set(s).add(tempId));
    updateDraft("");
    setSending(true);
    setLive("Looking through your notes.");
    const markFailed = (why: string) => {
      play("boop");
      setLive(why);
      setMessages((list) => list.map((m) => (m.id === tempId ? { ...m, pending: false, failed: why } : m)));
    };
    try {
      const r = await askQuestion({ subjectId: subject.id, question, clientKey });
      if (!r.ok) { markFailed(r.error); return; }
      const res = r.result;
      setQuota(res.quota);
      if (res.status === "answered") {
        const follow = atBottom();
        stick.current = follow ? "bottom" : null;
        if (!follow) setNewChip(true);
        if (res.mode) setMode(res.mode);
        setMessages((list) => [...list.filter((m) => m.id !== tempId), res.question, res.answer]);
        setNewIds((s) => new Set(s).add(res.answer.id));
        play("pop");
        const n = res.answer.citations.length;
        setLive(res.answer.kind === "answer"
          ? `Answer: ${plainText(res.answer.content)} ${plural(n, "source")}.`
          : `${res.answer.content} Try asking about something in your notes, or add a note about it.`);
        return;
      }
      // Limits: the question goes back into the composer, which the limit sticker replaces.
      if (res.status === "limit" || res.status === "allowance" || res.status === "no_sources") {
        play("boop");
        setMessages((list) => list.filter((m) => m.id !== tempId));
        updateDraft(question);
        if (res.status === "limit") setLimitHit(true);
        if (res.status === "no_sources") setNoSources(true);
        setLive(res.status === "limit" ? "You've used today's questions." : res.status === "allowance" ? "Today's free AI allowance is used up." : "Add a note or a lecture file first.");
        return;
      }
      markFailed(res.status === "not_configured" ? "AI isn't set up yet, so questions can't be answered." : FAILED);
    } catch {
      markFailed(FAILED);
    } finally {
      setSending(false);
    }
  // updateDraft only writes this subject's draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sending, offline, play, subject.id]);

  async function older() {
    const first = messages.find((m) => !m.id.startsWith("tmp-"));
    if (!first || loadingOlder) return;
    setLoadingOlder(true);
    const r = await loadOlderChat({ subjectId: subject.id, before: first.createdAt }).catch(() => null);
    setLoadingOlder(false);
    if (!r?.ok) { play("boop"); toast.show("Couldn't load earlier messages."); return; }
    keepFrom.current = document.documentElement.scrollHeight;
    stick.current = "keep";
    setMessages((list) => [...r.messages, ...list]);
    setHasOlder(r.hasOlder);
  }

  async function clear() {
    const r = await clearChat(subject.id).catch(() => null);
    setConfirmClear(false);
    if (!r?.ok) { play("boop"); toast.show("Couldn't clear the chat. Try again."); return; }
    speech.stop();
    setMessages([]);
    setHasOlder(false);
    toast.show("Chat cleared");
  }

  async function feedback(id: string, f: "wrong" | "not_in_notes" | "too_long") {
    const r = await sendChatFeedback({ messageId: id, feedback: f }).catch(() => null);
    if (!r?.ok) { play("boop"); toast.show("Couldn't send that. Try again."); return; }
    setMessages((list) => list.map((m) => (m.id === id ? { ...m, feedback: f } : m)));
    toast.show("Thanks for telling us.");
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.show("Copied");
    } catch {
      play("boop");
      toast.show("Couldn't copy. Select the text instead.");
    }
  }

  const sourcesLine = [data.notes ? plural(data.notes, "note") : null, data.readyFiles ? plural(data.readyFiles, "file") : null].filter(Boolean).join(" and ");
  const intro = sourcesLine ? `Answers come only from your ${sourcesLine}.` : null;
  const latestAnswer = [...messages].reverse().find((m) => m.role === "assistant");
  const empty = messages.length === 0;
  const reasonId = `${uid}-reason`;
  const hintId = `${uid}-hints`;
  const showChip = quota.left <= 3;
  const near = draft.length >= CHAT_QUESTION_MAX * 0.8;
  const disabledReason = noSources ? "Add a note or a lecture file first, then ask away." : offline ? "You're offline. Your question will wait here." : null;

  const days = messages.map((m) => dayKey(m.createdAt, tz));
  return (
    <div className="-mb-24 flex min-h-[calc(100dvh-140px)] flex-col" style={subjectStyle(subject.colour)}>
      <header className="flex flex-col gap-1 pb-4">
        <div className="flex items-center gap-2">
          <Link href={`/subjects/${subject.id}`} className="inline-flex min-h-11 min-w-11 items-center font-bold underline-offset-4 hover:underline" aria-label={`Back to ${subject.name}`} onClick={() => play("click")}>
            ←<span className="hidden sm:inline">&nbsp;{subject.name}</span>
          </Link>
          <span className="hidden sm:inline-flex"><SubjectChip name={subject.name} emoji={subject.emoji} colour={subject.colour} /></span>
          <span className="sm:hidden" aria-hidden="true">{subject.emoji}</span>
          <h1 className="font-display min-w-0 flex-1 text-xl sm:hidden">Ask your notes</h1>
          <span className="hidden flex-1 sm:block" />
          {messages.length > 0 && <RowMenu label="Chat options" items={[{ label: "Clear chat", onSelect: () => setConfirmClear(true), danger: true }]} />}
        </div>
        <h1 className="font-display hidden text-[28px] sm:block">Ask your notes</h1>
        {intro && <p className="hidden text-ink-soft sm:block">{intro}</p>}
      </header>

      <div className="flex flex-1 flex-col">
        <div role="log" aria-label="Chat" aria-live="off" className="chat-log flex-1" data-testid="chat-log">
          {latestAnswer && <a href="#latest-answer" className="sr-only focus:not-sr-only focus:self-start focus:rounded-md focus:bg-card focus:px-2 focus:py-1">Skip to latest answer</a>}
          {hasOlder && (
            <Button size="sm" variant="ghost" className="self-center" onClick={() => void older()} disabled={loadingOlder}>
              {loadingOlder ? "Loading…" : "Show earlier messages"}
            </Button>
          )}
          {empty && !noSources && (
            <div className="sticker relative mx-auto my-6 flex w-full max-w-lg flex-col items-center gap-3 p-6 text-center" data-testid="chat-empty">
              <span className="tape" aria-hidden="true" />
              <p className="font-display text-2xl">Ask your notes anything</p>
              <p>I&apos;ll answer only from your {subject.name} notes and files, and show you where each bit came from.</p>
              {intro && <p className="text-ink-soft sm:hidden">{intro}</p>}
              {data.suggestions.length > 0 && !blocked && (
                <div role="group" aria-label="Suggested questions" className="suggestions w-full">
                  {data.suggestions.map((s) => (
                    <button key={s} type="button" className="btn btn-sm min-h-11" disabled={sending || offline} onClick={() => void send(s)}>{s}</button>
                  ))}
                </div>
              )}
            </div>
          )}
          {empty && noSources && (
            <div className="sticker relative mx-auto my-6 flex w-full max-w-lg flex-col items-center gap-3 p-6 text-center" data-testid="chat-no-sources">
              <span className="tape" aria-hidden="true" />
              <p className="font-display text-2xl">Add a note or a lecture file first, then ask away.</p>
              <Link href={`/subjects/${subject.id}`} className="btn btn-primary" onClick={() => play("click")}>Back to {subject.name}</Link>
            </div>
          )}
          {messages.map((m, i) => {
            const sep = i === 0 || days[i] !== days[i - 1] ? <p className="chip day-chip" data-testid="day-chip">{dayLabel(m.createdAt, tz)}</p> : null;
            return (
              <div key={m.id} className="contents">
                {sep}
                <ChatMessage
                  m={m} emoji={subject.emoji} isNew={newIds.has(m.id)} latest={m.id === latestAnswer?.id}
                  openN={preview?.messageId === m.id ? preview.c.n : null}
                  onCite={(c, el) => setPreview({ c, el, messageId: m.id })}
                  onRetry={(x) => void send(x.content, x.clientKey)}
                  onCopy={(t) => void copy(t)}
                  onFeedback={(id, f) => void feedback(id, f)}
                />
              </div>
            );
          })}
          {sending && <Typing still={focusMode} />}
        </div>

        <div className="composer mt-4">
          <div className="mx-auto flex w-full max-w-[760px] flex-col gap-2">
            {newChip && (
              <button type="button" className="chip chip-due self-center min-h-11 px-4" onClick={() => { play("click"); setNewChip(false); window.scrollTo({ top: document.documentElement.scrollHeight, behavior: reducedMotion() ? "auto" : "smooth" }); }}>
                New answer ↓
              </button>
            )}
            {data.reading.length > 0 && (
              <p className="hint" data-testid="reading-hint">
                {data.reading.length === 1 ? `${data.reading[0]} is` : `${data.reading.slice(0, -1).join(", ")} and ${data.reading.at(-1)} are`} still being read. Ask again in a minute to include {data.reading.length === 1 ? "it" : "them"}.
              </p>
            )}
            {blocked ? (
              <div className="sticker flex flex-col gap-3 p-4" role="status" data-testid="chat-limit">
                <p className="font-bold">
                  {allowanceOut && !outOfGoes
                    ? "Today's free AI allowance is used up. Try again tomorrow. Your notes are safe."
                    : quota.left === 0 ? `You've asked ${quota.limit} questions today. More tomorrow! Your chat is saved.`
                    : "You've reached today's limit for questions. More tomorrow! Your chat is saved."}
                </p>
                {!allowanceOut && (data.quizLeft > 0 || data.dueCards > 0) && (
                  <div className="flex flex-wrap gap-2">
                    {data.quizLeft > 0 && <Link href={`/subjects/${subject.id}/quizzes?make=1`} className="btn btn-sm min-h-11" onClick={() => play("click")}>Make a quiz</Link>}
                    {data.dueCards > 0 && <Link href={`/subjects/${subject.id}/review`} className="btn btn-sm min-h-11" onClick={() => play("click")}>Review flashcards</Link>}
                  </div>
                )}
              </div>
            ) : (
              <form
                className="flex items-end gap-2"
                onSubmit={(e) => { e.preventDefault(); void send(draft); }}
              >
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <label htmlFor={`${uid}-q`} className="sr-only sm:not-sr-only sm:text-sm sm:font-bold">Ask a question about {subject.name}</label>
                  <textarea
                    id={`${uid}-q`} ref={textRef} className="input" rows={1} maxLength={CHAT_QUESTION_MAX} value={draft}
                    placeholder={`Ask about your ${subject.name} notes…`}
                    disabled={noSources}
                    aria-describedby={[disabledReason ? reasonId : "", hintId].filter(Boolean).join(" ")}
                    onChange={(e) => updateDraft(e.target.value)}
                    onKeyDown={(e) => {
                      // Enter sends, Shift+Enter is a new line; on touch screens Enter is a new line and the button sends.
                      if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || coarse) return;
                      e.preventDefault();
                      void send(draft);
                    }}
                    data-testid="composer"
                  />
                </div>
                <Button
                  type="submit" variant="primary" sound={null} className="icon-btn min-h-11 min-w-11" aria-label="Send"
                  disabled={!draft.trim() || sending || offline || noSources}
                >
                  <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
                    <path d="M3 11.5 21 3l-6.5 18-3-7.5L3 11.5z" fill="currentColor" fillOpacity="0.15" /><path d="m11.5 13.5 4-4" />
                  </svg>
                </Button>
              </form>
            )}
            <div id={hintId} className="flex flex-wrap items-center gap-2">
              {disabledReason && <p id={reasonId} className="hint">{disabledReason}</p>}
              {!blocked && (
                <span data-testid="chat-quota" className={`chip ${quota.left === 0 ? "chip-limit" : ""} ${showChip ? "" : "hidden sm:inline-flex"}`}>
                  {quota.left} of {quota.limit} questions left today
                </span>
              )}
              {near && !blocked && <span className="hint" aria-live="polite">{draft.length} / {CHAT_QUESTION_MAX}</span>}
              {mode === "keywords" && !noSources && <p className="hint w-full text-sm" data-testid="keyword-hint">Searching your notes by keywords today, so answers may miss a few things.</p>}
            </div>
          </div>
        </div>
      </div>

      <p className="sr-only" role="status" aria-live="polite" data-testid="chat-live">{live}</p>
      <CitationPreview citation={preview?.c ?? null} anchor={preview?.el ?? null} onClose={() => setPreview(null)} />
      <Dialog open={confirmClear} onClose={() => setConfirmClear(false)} title="Clear this chat?">
        <p>Your notes stay as they are.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmClear(false)}>Cancel</Button>
          <Button variant="danger" sound="tear" onClick={() => void clear()}>Clear chat</Button>
        </div>
      </Dialog>
      {toast.node}
    </div>
  );
}
