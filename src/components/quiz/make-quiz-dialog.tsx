"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { QUIZ_MAX_CHARS, type Quota } from "@/lib/limits/ai";
import { defaultRange, modeOf, pagesSpoken, pagesText, rangeError, rangeHint, type PageRange, type PageUnit, type RefitMode } from "@/lib/page-range";
import { KIND_LABEL, type QuizCount, type QuizKind } from "@/lib/quiz/order";
import { MAX_QUIZ_PAGES } from "@/lib/validation";
import { loadQuizOptions, makeQuiz, type MakeQuizResult, type QuizMadeFrom, type QuizMakeOptions } from "@/server/actions/quiz";
import { useSound } from "../sound-provider";
import { useActionToast } from "../ui/action-toast";
import { Button } from "../ui/button";
import { PageRangeFields, type RangeFieldError } from "../ui/page-range-fields";
import { QuotaChip } from "../ui/quota-chip";

/** What the dialog opens with: a file or note row, "Practise weak topics", or "Practise what I missed". */
export type QuizPreset = { type: "note" | "file"; id: string } | { type: "weak"; topics?: string[] };
type Choice = { type: "all" } | { type: "note" | "file"; id: string };
type FileOption = QuizMakeOptions["files"][number];

type Phase =
  | { kind: "loading" }
  | { kind: "choose" }
  | { kind: "generating"; range: PageRange | null; unit: PageUnit; sampled: boolean }
  | { kind: "ready"; quizId: string; count: number; requested: number; from: QuizMadeFrom }
  | { kind: "message"; result: Exclude<MakeQuizResult, { status: "made" }> }
  | { kind: "error"; text: string };

const LINES = ["Reading your notes…", "Picking what matters…", "Writing questions…", "Checking every answer against your notes…", "Nearly there…"];
const KIND_HINT: Record<QuizKind, string> = { mcq: "Pick the right answer from four.", fill: "Type the missing word or number.", mixed: "A bit of both." };
const COUNTS: QuizCount[] = [5, 10, 15];

const filePages = (f: FileOption) => Math.max(1, f.pageCount ?? 0, f.pageChars?.length ?? 0);
const unitOf = (f: FileOption | undefined): PageUnit => (f?.kind === "pptx" ? "slide" : "page");
const isLong = (f: FileOption | undefined): f is FileOption => !!f && f.status === "ready" && !f.fitsOneSet;
const canChoose = (f: FileOption | undefined): f is FileOption => !!f && f.status === "ready" && f.fitsOneSet && filePages(f) >= 2;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** "From Lecture 3.pdf, pages 1–20 · Mixed". */
export function madeFromText(f: QuizMadeFrom): { name: string; rest: string } {
  const name = f.kind === "all" ? `everything in ${f.name}` : f.name;
  return { name, rest: `${f.range ? `, ${f.range}` : ""} · ${f.kindLabel}` };
}

/**
 * "Make a quiz" (quiz-builder.md): Focus, Source (with page ranges), Question type and How
 * many → generating → "Quiz ready!", with the friendly messages for limits and short notes.
 */
export function MakeQuizDialog({ subjectId, subjectName, open, onClose, preset, onMade }: {
  subjectId: string;
  subjectName: string;
  open: boolean;
  onClose: () => void;
  preset?: QuizPreset | null;
  onMade?: (quizId: string, quota: Quota) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [opts, setOpts] = useState<QuizMakeOptions | null>(null);
  const [focus, setFocus] = useState<"all" | "weak">("all");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [tickErr, setTickErr] = useState(false);
  const [choice, setChoice] = useState<Choice>({ type: "all" });
  const [showList, setShowList] = useState(true);
  const [kind, setKind] = useState<QuizKind>("mixed");
  const [count, setCount] = useState<QuizCount>(10);
  const [fields, setFields] = useState({ from: "1", to: "1" });
  const [rangeErr, setRangeErr] = useState<RangeFieldError>(null);
  const [mode, setMode] = useState<RefitMode>({ kind: "fit" });
  const [choosePages, setChoosePages] = useState(false);
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

  /** Default page range: page 1 to the best fit (quizzes don't remember coverage). */
  function initRange(file: FileOption | undefined) {
    setRangeErr(null);
    setChoosePages(false);
    if (!file || file.status !== "ready") return;
    const pageCount = filePages(file);
    const r = isLong(file) ? defaultRange(file.pageChars, file.looseChars, pageCount, 1, QUIZ_MAX_CHARS) : { from: 1, to: pageCount };
    setFields({ from: String(r.from), to: String(r.to) });
    setMode(modeOf(file.pageChars, file.looseChars, r, QUIZ_MAX_CHARS));
  }

  const presetKey = preset ? (preset.type === "weak" ? `weak:${(preset.topics ?? []).join("\u0000")}` : `${preset.type}:${preset.id}`) : "";
  useEffect(() => {
    if (!open) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPhase((p) => (p.kind === "generating" ? p : { kind: "loading" }));
    void loadQuizOptions(subjectId).then((res) => {
      if (!alive) return;
      if (!res.ok) { setPhase({ kind: "error", text: res.error }); return; }
      setOpts(res);
      setTickErr(false);
      const [type, ...rest] = presetKey.split(":");
      if (type === "weak") {
        const wanted = rest.join(":").split("\u0000").filter(Boolean).map((t) => t.trim().toLowerCase());
        const keys = res.weak.map((w) => w.key);
        setTicked(new Set(wanted.length ? keys.filter((k) => wanted.includes(k)) : keys));
        setFocus(res.weak.length ? "weak" : "all");
        setChoice({ type: "all" });
        setShowList(true);
      } else {
        setTicked(new Set(res.weak.map((w) => w.key)));
        setFocus("all");
        const id = rest.join(":");
        setChoice(type === "note" || type === "file" ? { type, id } : { type: "all" });
        setShowList(!(type === "note" || type === "file"));
        if (type === "file") initRange(res.files.find((f) => f.id === id));
        else { setRangeErr(null); setChoosePages(false); }
      }
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
  useEffect(() => {
    if (phase.kind === "ready" || phase.kind === "message") titleRef.current?.focus();
    if (phase.kind === "generating") closeRef.current?.focus();
  }, [phase.kind]);

  const selectedFile = choice.type === "file" ? opts?.files.find((f) => f.id === choice.id) : undefined;
  const rangeFile = focus === "all" && (isLong(selectedFile) || (choosePages && canChoose(selectedFile))) ? selectedFile : undefined;
  const unit = unitOf(selectedFile);
  const pageCount = rangeFile ? filePages(rangeFile) : 1;
  const readyFiles = opts?.files.filter((f) => f.status === "ready") ?? [];
  const usableNotes = opts?.notes.filter((n) => n.chars > 0) ?? [];
  const hasAnything = usableNotes.length + readyFiles.length > 0;

  async function generate() {
    if (!opts) return;
    const long = rangeFile;
    const range = long ? { from: Number(fields.from), to: Number(fields.to) } : null;
    const hint = long && range ? rangeHint(long.pageChars, long.looseChars, range, unit, QUIZ_MAX_CHARS, "Questions") : null;
    setPhase({ kind: "generating", range, unit, sampled: hint?.kind === "sampled" || hint?.kind === "long_page" });
    setLine(0);
    const weakTopics = opts.weak.filter((w) => ticked.has(w.key)).map((w) => w.name);
    const source = focus === "weak"
      ? { type: "weak" as const, topics: weakTopics }
      : choice.type === "all" ? { type: "all" as const }
      : choice.type === "note" ? { type: "note" as const, id: choice.id }
      : range ? { type: "file" as const, id: choice.id, fromPage: range.from, toPage: range.to } : { type: "file" as const, id: choice.id };
    const res = await makeQuiz({ subjectId, source, kind, count }).catch(() => null);
    if (!res || !res.ok) {
      play("boop");
      setPhase(res && !res.ok ? { kind: "error", text: res.error } : { kind: "message", result: { status: "failed", quota: opts.quota } });
      return;
    }
    const r = res.result;
    setOpts((o) => (o ? { ...o, quota: r.quota } : o));
    if (r.status === "made") {
      onMade?.(r.quizId, r.quota);
      setPhase({ kind: "ready", quizId: r.quizId, count: r.count, requested: r.requested, from: r.from });
      if (openRef.current) play("pop");
      else toast.show(`Your ${subjectName} quiz is ready`, { label: "Start quiz", href: `/subjects/${subjectId}/quizzes/${r.quizId}` });
      router.refresh();
      return;
    }
    if (r.status !== "already") play("boop");
    setPhase({ kind: "message", result: r });
  }

  function submit() {
    if (focus === "weak") {
      if (ticked.size === 0) { setTickErr(true); play("boop"); return; }
    } else if (rangeFile) {
      const err = rangeError(fields.from, fields.to, pageCount, unit, MAX_QUIZ_PAGES);
      if (err) {
        setRangeErr(err);
        play("boop");
        (err.field === "from" ? fromRef : toRef).current?.focus();
        return;
      }
    }
    void generate();
  }

  const close = () => {
    onClose();
    if (phase.kind !== "generating") setPhase({ kind: "loading" });
  };
  const back = () => { setShowList(true); setPhase({ kind: "choose" }); };

  const sourceRow = (c: Choice, key: string, icon: string, title: string, meta: string, disabled: string | null) => (
    <li key={key}>
      <label className={`flex min-h-11 items-center gap-3 rounded-md border-2 border-transparent p-2 ${disabled ? "opacity-60" : "cursor-pointer hover:border-ink"}`}>
        <input
          type="radio" name={`${uid}-src`} className="h-5 w-5 accent-[var(--ink)]" disabled={!!disabled}
          checked={choice.type === c.type && (c.type === "all" || (choice.type !== "all" && choice.id === c.id))}
          onChange={() => {
            play("click");
            setChoice(c);
            if (c.type === "file") initRange(opts?.files.find((f) => f.id === c.id));
            else { setRangeErr(null); setChoosePages(false); }
          }}
        />
        <span aria-hidden="true">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{title}</span>
          <span className="hint">{disabled ?? meta}</span>
        </span>
      </label>
    </li>
  );

  const seg = <T extends string | number>(name: string, legend: string, values: readonly T[], value: T, set: (v: T) => void, label: (v: T) => string, describedBy?: string) => (
    <fieldset className="flex flex-col gap-1" aria-describedby={describedBy}>
      <legend className="label">{legend}</legend>
      <div className="seg flex w-full sm:w-fit" role="radiogroup" aria-label={legend}>
        {values.map((v) => (
          <label key={String(v)} className="flex-1 whitespace-nowrap px-2 sm:flex-none">
            <input type="radio" className="sr-only" name={`${uid}-${name}`} checked={value === v} onChange={() => { play("click"); set(v); }} />
            {label(v)}
          </label>
        ))}
      </div>
    </fieldset>
  );

  let body: React.ReactNode;
  let title = "Make a quiz";
  if (phase.kind === "loading") {
    body = <div className="flex flex-col gap-2" aria-busy="true"><div className="skeleton h-10" /><div className="skeleton h-10" /><div className="skeleton h-10" /></div>;
  } else if (phase.kind === "error") {
    body = (<><p role="alert" className="error-text">{phase.text}</p><div className="flex justify-end"><Button onClick={close}>Close</Button></div></>);
  } else if (phase.kind === "choose" && opts) {
    const chosenTitle = choice.type === "note" ? opts.notes.find((n) => n.id === choice.id)?.title : choice.type === "file" ? selectedFile?.name : null;
    const everything = [usableNotes.length ? plural(usableNotes.length, "note") : null, readyFiles.length ? plural(readyFiles.length, "file") : null].filter(Boolean).join(" and ");
    body = (
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
        {opts.weak.length > 0 && seg("focus", "Focus", ["all", "weak"] as const, focus, (v) => { setFocus(v); setTickErr(false); }, (v) => (v === "all" ? "Anything" : `Weak topics · ${opts.weak.length}`))}
        {focus === "weak" ? (
          <fieldset className="flex flex-col gap-1" aria-describedby={`${uid}-weak-hint${tickErr ? ` ${uid}-weak-err` : ""}`}>
            <legend className="label">Weak topics</legend>
            <ul className="flex max-h-56 flex-col overflow-y-auto">
              {opts.weak.map((w) => (
                <li key={w.key}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-[var(--grid)]">
                    <input
                      type="checkbox" className="h-5 w-5 accent-[var(--ink)]" checked={ticked.has(w.key)}
                      onChange={(e) => {
                        play("click");
                        setTickErr(false);
                        setTicked((s) => { const n = new Set(s); if (e.target.checked) n.add(w.key); else n.delete(w.key); return n; });
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{w.name}</span>
                      <span className="hint">{w.missCount === 0 ? "added by you" : `missed ${w.missCount === 1 ? "once" : `${w.missCount} times`}`}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <p id={`${uid}-weak-hint`} className="hint">Questions come from the passages behind these topics.</p>
            {tickErr && <p id={`${uid}-weak-err`} className="error-text w-fit" role="alert">Tick at least one topic.</p>}
          </fieldset>
        ) : showList ? (
          <fieldset className="flex flex-col gap-3">
            <legend className="label mb-1">Source</legend>
            <ul className="flex flex-col">
              {sourceRow({ type: "all" }, "all", "📚", `Everything in ${subjectName}`, everything ? `${everything}, a quick sample` : "Nothing to quiz yet", hasAnything ? null : "Add a note or a lecture file first")}
            </ul>
            {opts.notes.length > 0 && (
              <div>
                <h3 className="font-bold">Notes</h3>
                <ul className="flex flex-col">{opts.notes.map((n) => sourceRow({ type: "note", id: n.id }, n.id, "📝", n.title, `${n.chars.toLocaleString("en")} characters`, n.chars > 0 ? null : "Empty note"))}</ul>
              </div>
            )}
            {opts.files.length > 0 && (
              <div>
                <h3 className="font-bold">Lecture files</h3>
                <ul className="flex flex-col">
                  {opts.files.map((f) => sourceRow({ type: "file", id: f.id }, f.id, "📄", f.name, `${f.pageCount ?? 0} ${f.kind === "pptx" ? "slides" : "pages"}`,
                    f.status === "ready" ? null : f.status === "pending" || f.status === "reading" ? "Still reading text…" : "No text found"))}
                </ul>
              </div>
            )}
          </fieldset>
        ) : (
          <p>
            From <strong>{chosenTitle ?? "this source"}</strong>.{" "}
            <button type="button" className="min-h-11 font-bold underline underline-offset-2" onClick={() => { play("click"); setShowList(true); }}>Change source</button>
          </p>
        )}
        {focus === "all" && canChoose(selectedFile) && (
          <p>
            <button
              type="button" className="min-h-11 font-bold underline underline-offset-2" aria-expanded={choosePages}
              onClick={() => {
                play("click");
                const pc = filePages(selectedFile);
                setRangeErr(null);
                if (!choosePages) {
                  setFields({ from: "1", to: String(pc) });
                  setMode(modeOf(selectedFile.pageChars, selectedFile.looseChars, { from: 1, to: pc }, QUIZ_MAX_CHARS));
                }
                setChoosePages(!choosePages);
              }}
            >
              {choosePages ? "Use the whole file" : `Choose ${unit}s`}
            </button>
          </p>
        )}
        {rangeFile && (
          <PageRangeFields
            uid={uid} file={rangeFile} pageCount={pageCount} unit={unit} budget={QUIZ_MAX_CHARS} noun="Questions"
            fields={fields} setFields={setFields} mode={mode} setMode={setMode} error={rangeErr} setError={setRangeErr} fromRef={fromRef} toRef={toRef}
          />
        )}
        <div className="flex flex-col gap-1">
          {seg("kind", "Question type", ["mcq", "fill", "mixed"] as const, kind, setKind, (v) => KIND_LABEL[v], `${uid}-kind-hint`)}
          <p id={`${uid}-kind-hint`} className="hint">{KIND_HINT[kind]}</p>
        </div>
        <div className="flex flex-col gap-1">
          {seg("count", "How many questions", COUNTS, count, setCount, (v) => String(v), `${uid}-count-hint`)}
          <p id={`${uid}-count-hint`} className="hint">We only ask what your notes can answer, so you might get fewer.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <QuotaChip quota={opts.quota} />
          <span className="hint">Each quiz uses one go. Retaking a quiz is free.</span>
        </div>
        <div className="sticky bottom-0 -mx-1 flex flex-col-reverse gap-2 bg-[var(--card)] px-1 pt-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" className="w-full sm:w-auto" disabled={focus === "all" && choice.type === "all" && !hasAnything}>Make quiz</Button>
        </div>
      </form>
    );
  } else if (phase.kind === "generating") {
    const lines = phase.range ? [`${phase.sampled ? "Skimming" : "Reading"} ${pagesText(phase.range, phase.unit)}…`, ...LINES.slice(1)] : LINES;
    body = (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="sticker quiz-sheet" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <div key={i} className="quiz-bubble">
              <span>
                <svg width="12" height="12" viewBox="0 0 12 12"><path className="tick-path" d="M2 6.5 L5 9 L10 3" style={{ animationDelay: `${i * 0.4}s` }} /></svg>
              </span>
              <span />
            </div>
          ))}
        </div>
        <p aria-hidden="true" className="font-bold">{lines[line]}</p>
        <p className="sr-only" role="status">
          {phase.range ? `Making your quiz from ${pagesSpoken(phase.range, phase.unit)}. This takes about 20 seconds.` : "Making your quiz. This takes about 20 seconds."}
        </p>
        <p className="hint">You can close this. We&apos;ll tell you when it&apos;s ready.</p>
        <Button ref={closeRef} variant="ghost" onClick={close}>Close</Button>
      </div>
    );
  } else if (phase.kind === "ready") {
    const from = madeFromText(phase.from);
    title = `Quiz ready! ${plural(phase.count, "question")}`;
    body = (
      <div className="flex flex-col gap-3">
        <p>From <strong>{from.name}</strong>{from.rest}</p>
        {phase.count < phase.requested && <p className="hint">Your notes had enough for {phase.count} good {phase.count === 1 ? "question" : "questions"}.</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={close}>Later</Button>
          <Link href={`/subjects/${subjectId}/quizzes/${phase.quizId}`} className="btn btn-primary" onClick={() => { play("click"); onClose(); }}>Start quiz</Link>
        </div>
      </div>
    );
  } else if (phase.kind === "message") {
    const r = phase.result;
    const msg: Record<typeof r.status, { emoji: string; text: string }> = {
      too_short: { emoji: "✏️", text: "There isn't enough here for a good quiz yet. Add a bit more to your notes or pick more pages." },
      limit: { emoji: "🌙", text: `You've made ${r.quota.limit} quizzes today. More tomorrow! You can still retake any quiz on your shelf.` },
      allowance: { emoji: "🌙", text: "Today's free AI allowance is used up. Try again tomorrow. Your notes and quizzes are safe." },
      already: { emoji: "📚", text: "You already have this quiz. Take it again for free, or pick different pages or a question type." },
      failed: { emoji: "🌀", text: "The quiz maker got muddled. Try again. This one didn't use up a go." },
      not_configured: { emoji: "🔌", text: "AI isn't set up yet, so quizzes can't be made right now." },
      weak_gone: { emoji: "🗂️", text: "The notes behind these topics are gone, so we can't quiz them. Untick them or mark them as got it." },
      weak_no_notes: { emoji: "🔎", text: "We couldn't find these topics in your notes yet. Add a note about them, then try again." },
    };
    const m = msg[r.status];
    body = (
      <div className="flex flex-col gap-4">
        <div className="sticker-flat flex items-start gap-3 p-4">
          <span className="text-3xl" aria-hidden="true">{m.emoji}</span>
          <p>{m.text}</p>
        </div>
        {r.status !== "already" && r.status !== "not_configured" && <div><QuotaChip quota={r.quota} /></div>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          {r.status === "too_short" && <Button variant="primary" onClick={back}>Pick another source</Button>}
          {r.status === "limit" && (
            <>
              <Button onClick={close}>Close</Button>
              <Link href={`/subjects/${subjectId}/quizzes`} className="btn btn-primary" onClick={() => { play("click"); close(); }}>See my quizzes</Link>
            </>
          )}
          {r.status === "already" && (
            <>
              <Button onClick={back}>Change settings</Button>
              <Link href={`/subjects/${subjectId}/quizzes/${r.quizId}`} className="btn btn-primary" onClick={() => { play("click"); onClose(); }}>Take that quiz</Link>
            </>
          )}
          {r.status === "failed" && <Button variant="primary" onClick={() => void generate()}>Try again</Button>}
          {(r.status === "weak_gone" || r.status === "weak_no_notes") && <Button variant="primary" onClick={back}>Back</Button>}
          {(r.status === "allowance" || r.status === "not_configured") && <Button onClick={close}>Close</Button>}
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
