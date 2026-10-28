"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { NOTES_MAX_CHARS } from "@/lib/limits/ai";
import { defaultRange, modeOf, pagesSpoken, pagesText, rangeError, type PageRange, type PageUnit, type RefitMode } from "@/lib/page-range";
import { timeAgo } from "@/lib/time";
import { loadNotesOptions, makeStudyNotes, type NotesOptions, type NotesResult } from "@/server/actions/study-notes";
import type { WebError } from "@/server/web-page";
import { useSound } from "../sound-provider";
import { useActionToast } from "../ui/action-toast";
import { Button } from "../ui/button";
import { PageRangeFields } from "../ui/page-range-fields";
import { QuotaChip } from "../ui/quota-chip";

type FileOption = NotesOptions["files"][number];
type Choice = { type: "note" | "file"; id: string } | { type: "web" };
type Made = Extract<NotesResult, { status: "made" }>;

type Phase =
  | { kind: "loading" }
  | { kind: "choose" }
  | { kind: "generating"; range: PageRange | null; unit: PageUnit; web: boolean }
  | { kind: "made"; result: Made }
  | { kind: "message"; result: Exclude<NotesResult, { status: "made" }> }
  | { kind: "error"; text: string };

const LINES = ["Reading it through…", "Picking out what matters…", "Writing your notes…", "Nearly there…"];

/** What went wrong reading a link, in the student's words (make-notes.md "Messages"). */
export const WEB_MESSAGES: Record<WebError, string> = {
  bad_url: "That doesn't look like a web link. Paste the full address, like https://en.wikipedia.org/wiki/Osmosis.",
  blocked: "That link can't be opened from StudyNest. Try a public web page.",
  unreachable: "We couldn't open that page. Check the link works in your browser and try again.",
  http: "That page didn't open for us. It may need a sign-in, or it may have moved.",
  not_html: "That link isn't a web page we can read. Try a page with text on it.",
  pdf: "That link is a PDF. Download it and add it under Lecture files, then make notes from it there.",
  too_slow: "That page took too long to open. Try again, or try another page.",
};

const filePages = (f: FileOption) => Math.max(1, f.pageCount ?? 0, f.pageChars?.length ?? 0);
const unitOf = (f: FileOption | undefined): PageUnit => (f?.kind === "pptx" ? "slide" : "page");
const isLong = (f: FileOption | undefined): f is FileOption => !!f && f.status === "ready" && !f.fitsOneSet;

/**
 * "Make study notes" (docs/design/screens/make-notes.md): pick a note, a lecture file (a page
 * range for long ones) or paste a web link; the notes are saved as a new note in the subject.
 */
export function MakeNotesDialog({ subjectId, subjectName, open, onClose }: { subjectId: string; subjectName: string; open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [opts, setOpts] = useState<NotesOptions | null>(null);
  const [tab, setTab] = useState<"mine" | "web">("mine");
  const [choice, setChoice] = useState<Choice | null>(null);
  const [url, setUrl] = useState("");
  const [urlErr, setUrlErr] = useState<string | null>(null);
  const [fields, setFields] = useState({ from: "1", to: "1" });
  const [rangeErr, setRangeErr] = useState<{ field: "from" | "to"; text: string } | null>(null);
  const [mode, setMode] = useState<RefitMode>({ kind: "fit" });
  const [line, setLine] = useState(0);
  const openRef = useRef(open);
  const { play } = useSound();
  const toast = useActionToast();
  const router = useRouter();
  const uid = useId();

  useEffect(() => { openRef.current = open; }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase((p) => (p.kind === "generating" ? p : { kind: "loading" }));
    void loadNotesOptions(subjectId).then((res) => {
      if (!alive) return;
      if (!res.ok) { setPhase({ kind: "error", text: res.error }); return; }
      setOpts(res);
      // Nothing of their own yet: start on the web link.
      if (!res.notes.length && !res.files.length) setTab("web");
      setPhase((p) => {
        if (p.kind === "generating") return p;
        if (res.quota.left === 0) { play("boop"); return { kind: "message", result: { status: "limit", quota: res.quota } }; }
        return { kind: "choose" };
      });
    });
    return () => { alive = false; };
  }, [open, subjectId, play]);

  useEffect(() => {
    if (phase.kind !== "generating") return;
    const t = setInterval(() => setLine((l) => (l + 1) % LINES.length), 3000);
    return () => clearInterval(t);
  }, [phase.kind]);
  useEffect(() => { if (phase.kind === "made" || phase.kind === "message") titleRef.current?.focus(); }, [phase.kind]);

  const selectedFile = choice?.type === "file" ? opts?.files.find((f) => f.id === choice.id) : undefined;
  const rangeFile = isLong(selectedFile) ? selectedFile : undefined;
  const unit = unitOf(selectedFile);
  const pageCount = rangeFile ? filePages(rangeFile) : 1;
  const quota = phase.kind === "message" ? phase.result.quota : phase.kind === "made" ? phase.result.quota : opts?.quota;

  function pickFile(file: FileOption | undefined) {
    setRangeErr(null);
    if (!isLong(file)) return;
    const r = defaultRange(file.pageChars, file.looseChars, filePages(file), 1, NOTES_MAX_CHARS);
    setFields({ from: String(r.from), to: String(r.to) });
    setMode(modeOf(file.pageChars, file.looseChars, r, NOTES_MAX_CHARS));
  }

  async function generate() {
    const web = tab === "web";
    if (!web && (!choice || choice.type === "web")) return;
    const range = !web && rangeFile ? { from: Number(fields.from), to: Number(fields.to) } : null;
    const source = web ? { type: "web" as const, url: url.trim() }
      : choice!.type === "note" ? { type: "note" as const, id: (choice as { id: string }).id }
      : range ? { type: "file" as const, id: (choice as { id: string }).id, fromPage: range.from, toPage: range.to }
      : { type: "file" as const, id: (choice as { id: string }).id };
    setPhase({ kind: "generating", range, unit, web });
    setLine(0);
    const res = await makeStudyNotes({ subjectId, source }).catch(() => null);
    if (!res || !res.ok) {
      play("boop");
      setPhase(res && !res.ok ? { kind: "error", text: res.error } : { kind: "message", result: { status: "failed", quota: opts!.quota } });
      return;
    }
    const r = res.result;
    setOpts((o) => (o ? { ...o, quota: r.quota } : o));
    if (r.status === "made") {
      setPhase({ kind: "made", result: r });
      if (openRef.current) play("pop");
      else toast.show(`Your ${subjectName} study notes are ready`, { label: "Open notes", href: `/subjects/${subjectId}/notes/${r.noteId}` });
      router.refresh();
      return;
    }
    play("boop");
    setPhase({ kind: "message", result: r });
  }

  function submit() {
    if (tab === "web") {
      if (!url.trim()) { setUrlErr("Paste a link to a web page."); play("boop"); urlRef.current?.focus(); return; }
      setUrlErr(null);
    } else if (rangeFile) {
      const err = rangeError(fields.from, fields.to, pageCount, unit);
      if (err) { setRangeErr(err); play("boop"); (err.field === "from" ? fromRef : toRef).current?.focus(); return; }
    }
    void generate();
  }

  const close = () => {
    onClose();
    if (phase.kind !== "generating") setPhase({ kind: "loading" });
  };

  const sourceRow = (kind: "note" | "file", id: string, title: string, meta: string, disabled: string | null) => (
    <li key={id}>
      <label className={`flex min-h-11 items-center gap-3 rounded-md border-2 border-transparent p-2 ${disabled ? "opacity-60" : "cursor-pointer hover:border-ink"}`}>
        <input
          type="radio" name={`${uid}-src`} className="h-5 w-5 accent-[var(--ink)]" disabled={!!disabled}
          checked={choice?.type === kind && "id" in choice && choice.id === id}
          onChange={() => { play("click"); setChoice({ type: kind, id }); if (kind === "file") pickFile(opts?.files.find((f) => f.id === id)); else setRangeErr(null); }}
        />
        <span aria-hidden="true">{kind === "note" ? "📝" : "📄"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{title}</span>
          <span className="hint">{disabled ?? meta}</span>
        </span>
      </label>
    </li>
  );

  let title = "Make study notes";
  let body: React.ReactNode = null;
  if (phase.kind === "loading") {
    body = <div className="flex flex-col gap-2" aria-busy="true"><div className="skeleton h-10" /><div className="skeleton h-10" /><div className="skeleton h-10" /></div>;
  } else if (phase.kind === "error") {
    body = (<><p role="alert" className="error-text">{phase.text}</p><div className="flex justify-end"><Button onClick={close}>Close</Button></div></>);
  } else if (phase.kind === "choose" && opts) {
    const canMake = tab === "web" ? true : !!choice && choice.type !== "web";
    body = (
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <p className="hint">We&apos;ll read it and write tidy notes: the key points under headings, plus the key terms. They&apos;re saved as a new note you can edit.</p>
        <div className="seg w-fit" role="group" aria-label="Make notes from">
          <button type="button" aria-pressed={tab === "mine"} onClick={() => { play("click"); setTab("mine"); }}>My notes &amp; files</button>
          <button type="button" aria-pressed={tab === "web"} onClick={() => { play("click"); setTab("web"); setTimeout(() => urlRef.current?.focus(), 0); }}>A web page</button>
        </div>
        {tab === "mine" ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="label mb-1">Choose a source</legend>
            {opts.notes.length === 0 && opts.files.length === 0 && <p className="hint">Add a note or a lecture file first, or make notes from a web page.</p>}
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
            {rangeFile && (
              <PageRangeFields
                uid={uid} file={rangeFile} pageCount={pageCount} unit={unit} budget={NOTES_MAX_CHARS} noun="Notes"
                fields={fields} setFields={setFields} mode={mode} setMode={setMode} error={rangeErr} setError={setRangeErr}
                fromRef={fromRef} toRef={toRef} before={`Long file: notes are made a few ${unit}s at a time.`}
              />
            )}
          </fieldset>
        ) : (
          <div className="flex flex-col gap-1">
            <label className="label" htmlFor={`${uid}-url`}>Link to a web page</label>
            <input
              id={`${uid}-url`} ref={urlRef} type="url" inputMode="url" autoComplete="url" className="input" placeholder="https://en.wikipedia.org/wiki/Osmosis"
              value={url} maxLength={2000} onChange={(e) => { setUrl(e.target.value); if (urlErr) setUrlErr(null); }}
              aria-invalid={!!urlErr || undefined} aria-describedby={`${uid}-url-hint${urlErr ? ` ${uid}-url-err` : ""}`}
            />
            {urlErr && <p id={`${uid}-url-err`} role="alert" className="error-text">{urlErr}</p>}
            <p id={`${uid}-url-hint`} className="hint">Public pages only, like an encyclopedia article or a reading your lecturer shared. Pages behind a sign-in can&apos;t be read.</p>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <QuotaChip quota={opts.quota} />
          <span className="hint">Making notes from the same text again is free.</span>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" sound={null} disabled={!canMake}>Make notes</Button>
        </div>
      </form>
    );
  } else if (phase.kind === "generating") {
    const lines = phase.range ? [`Reading ${pagesText(phase.range, phase.unit)}…`, ...LINES.slice(1)] : phase.web ? ["Opening the page…", ...LINES.slice(1)] : LINES;
    body = (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="relative h-28 w-40" aria-hidden="true">
          {[-2, 3, -1].map((r, i) => (
            <span key={i} className="sticker shuffle absolute inset-0" style={{ ["--r" as string]: `${r}deg`, animationDelay: `${i * 0.4}s`, top: i * 6, left: i * 6 }} />
          ))}
        </div>
        <p aria-hidden="true" className="font-bold">{lines[line]}</p>
        <p className="sr-only" role="status">
          {phase.range ? `Making study notes from ${pagesSpoken(phase.range, phase.unit)}. This takes about 20 seconds.` : "Making study notes. This takes about 20 seconds."}
        </p>
        <p className="hint">You can close this. We&apos;ll tell you when they&apos;re ready.</p>
        <Button variant="ghost" onClick={close}>Close</Button>
      </div>
    );
  } else if (phase.kind === "made") {
    const r = phase.result;
    title = "Your notes are ready! ✨";
    body = (
      <div className="flex flex-col gap-3" data-testid="notes-made">
        <p><strong>{r.title}</strong></p>
        <p>{r.points} key {r.points === 1 ? "point" : "points"}{r.terms ? ` and ${r.terms} key ${r.terms === 1 ? "term" : "terms"}` : ""}, saved as a new note.</p>
        {r.sampled && <p className="hint">It was a lot of text, so the notes cover it evenly. For fuller notes, make them a few pages at a time.</p>}
        <p className="hint">Check them against the original. Then turn them into flashcards or a mindmap.</p>
        {quota && <div><QuotaChip quota={quota} /></div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={close}>Done</Button>
          <Link href={`/subjects/${subjectId}/notes/${r.noteId}`} className="btn btn-primary" onClick={() => { play("click"); onClose(); }}>Open notes</Link>
        </div>
      </div>
    );
  } else if (phase.kind === "message") {
    const r = phase.result;
    const text = r.status === "web_error" ? WEB_MESSAGES[r.reason]
      : r.status === "too_short" ? (r.sourceType === "web" ? "That page doesn't have enough text to make notes from. It may need a sign-in, or load its text in a way we can't read." : r.sourceType === "file" ? "This file doesn't have enough text for notes." : "This note is a bit short for study notes. Add a paragraph or two and try again.")
      : r.status === "limit" ? `You've made all ${r.quota.limit} sets of study notes for today. More tomorrow!`
      : r.status === "allowance" ? "Today's free AI allowance is used up. Try again tomorrow. Your notes are safe."
      : r.status === "not_configured" ? "AI isn't set up yet, so study notes can't be made right now."
      : "The note maker got muddled. Try again. This one didn't use up a go.";
    const emoji = r.status === "web_error" ? "🔗" : r.status === "too_short" ? "✏️" : r.status === "failed" ? "🌀" : r.status === "not_configured" ? "🔌" : "🌙";
    const back = r.status === "web_error" || r.status === "too_short" || r.status === "failed";
    body = (
      <div className="flex flex-col gap-4">
        <div className="sticker-flat flex items-start gap-3 p-4"><span className="text-3xl" aria-hidden="true">{emoji}</span><p>{text}</p></div>
        {r.status !== "not_configured" && <div><QuotaChip quota={r.quota} /></div>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant={back ? "ghost" : "plain"} onClick={close}>Close</Button>
          {back && <Button variant="primary" onClick={() => setPhase({ kind: "choose" })}>{r.status === "failed" ? "Try again" : "Back"}</Button>}
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

/** The "✨ Make notes" button on the subject page, with its dialog. */
export function MakeNotesButton({ subjectId, subjectName, label = "Make notes" }: { subjectId: string; subjectName: string; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)} data-testid="make-notes"><span aria-hidden="true">✨ </span>{label}</Button>
      <MakeNotesDialog subjectId={subjectId} subjectName={subjectName} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
