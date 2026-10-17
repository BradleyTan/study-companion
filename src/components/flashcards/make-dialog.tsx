"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { timeAgo } from "@/lib/time";
import type { Quota } from "@/lib/limits/ai";
import {
  coveredCount, coverageText, defaultRange, effectiveCoverage, firstUnmade, madeSoFarText, mergeRanges, modeOf, overlapOf, pagesSpoken, pagesText,
  pagesTitle, parseCoverage, quickPicks, rangeError, rangeHint, refit, type Coverage, type PageRange, type PageUnit, type RefitMode,
} from "@/lib/page-range";
import { deleteCard, loadMakeOptions, makeFlashcards, restoreCard, updateCard, type FileSeries, type MakeOptions, type MakeResult } from "@/server/actions/flashcards";
import type { DeckCard } from "@/server/cards";
import { useSound } from "../sound-provider";
import { useActionToast } from "../ui/action-toast";
import { Button } from "../ui/button";
import { ProgressBar } from "../ui/progress-bar";
import { QuotaChip } from "../ui/quota-chip";
import { CardEditor } from "./card-editor";

export type MakePreset = { type: "note" | "file"; id: string };
type FileOption = MakeOptions["files"][number];

/** A file's pages covered so far, as the result step shows it. */
type SeriesView = {
  unit: PageUnit;
  pageCount: number;
  range: PageRange;
  /** "Pages 1–34 of 42 done", "26 of 42 pages done" or "All 42 pages done. Nice work!". */
  text: string;
  /** Share of pages covered, before this set (the bar animates from it) and after. */
  before: number;
  value: number;
  next: PageRange | null;
};

type Phase =
  | { kind: "loading" }
  | { kind: "choose" }
  | { kind: "generating"; range: PageRange | null; unit: PageUnit; sampled: boolean }
  | { kind: "result"; cards: DeckCard[]; requested: number; skipped: number; dropped: number; series: SeriesView | null }
  | { kind: "message"; result: Exclude<MakeResult, { status: "made" }>; series?: SeriesView | null }
  | { kind: "error"; text: string };

const LINES = ["Reading your notes…", "Picking out the key ideas…", "Writing questions…", "Nearly there…"];

// Pages made per file (union of ranges), so the next visit starts on a new page (flashcards.md).
const rangesKey = (sourceId: string) => `studynest:cardRanges:${sourceId}`;
/** The old key held only the furthest page; read once as [[1, n]], then removed. */
const oldRangeKey = (sourceId: string) => `studynest:cardRange:${sourceId}`;
function readCoverage(sourceId: string): { list: Coverage; stored: boolean } {
  try {
    const raw = localStorage.getItem(rangesKey(sourceId));
    if (raw !== null) return { list: parseCoverage(raw), stored: true };
    const old = localStorage.getItem(oldRangeKey(sourceId));
    if (old === null) return { list: [], stored: true };
    const n = Number(old);
    const list: Coverage = Number.isInteger(n) && n > 0 && n <= 10_000 ? [[1, n]] : [];
    if (list.length) localStorage.setItem(rangesKey(sourceId), JSON.stringify(list));
    localStorage.removeItem(oldRangeKey(sourceId));
    return { list, stored: true };
  } catch {
    return { list: [], stored: false };
  }
}
function writeCoverage(sourceId: string, list: Coverage) {
  try { localStorage.setItem(rangesKey(sourceId), JSON.stringify(list)); } catch {}
}

const filePages = (f: FileOption) => Math.max(1, f.pageCount ?? 0, f.pageChars?.length ?? 0);
const unitOf = (f: FileOption | undefined): PageUnit => (f?.kind === "pptx" ? "slide" : "page");
const isLong = (f: FileOption | undefined): f is FileOption => !!f && f.status === "ready" && !f.fitsOneSet;
/** A file that fits one set but has pages to choose from ("Choose pages"). */
const canChoose = (f: FileOption | undefined): f is FileOption => !!f && f.status === "ready" && f.fitsOneSet && filePages(f) >= 2;

/**
 * "Make flashcards" (flashcards.md): choose a source → generating → result, with the
 * friendly messages for limits, short notes, cache hits and failures. Long files get a
 * page range and are made as a series of sets ("Long files: page ranges and series").
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
  const fromRef = useRef<HTMLInputElement>(null);
  const toRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [opts, setOpts] = useState<MakeOptions | null>(null);
  const [choice, setChoice] = useState<MakePreset | null>(null);
  const [showList, setShowList] = useState(true);
  const [count, setCount] = useState<10 | 15 | 20>(10);
  const [fields, setFields] = useState({ from: "1", to: "1" });
  const [rangeErr, setRangeErr] = useState<{ field: "from" | "to"; text: string } | null>(null);
  /** How "Last page" follows a new "First page": the pressed quick pick, else the current size. */
  const [mode, setMode] = useState<RefitMode>({ kind: "fit" });
  /** "Choose pages" on a file that fits one set (otherwise it is sent whole). */
  const [choosePages, setChoosePages] = useState(false);
  /** Pages made from the selected file; `stored` is false when browser storage is blocked. */
  const [coverage, setCoverage] = useState<{ fileId: string; list: Coverage; stored: boolean } | null>(null);
  /** Files with a sampled set made in this dialog ("(some passages sampled)"). */
  const sampledFiles = useRef(new Set<string>());
  const [spokenHint, setSpokenHint] = useState("");
  /** After "Next: pages 7–12" it is one more press: the Make button takes focus when Step 1 mounts. */
  const [focusMake, setFocusMake] = useState(false);
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

  /** Default page range: from the first page not made yet that has text, else page 1, by the fit rule. */
  function initRange(file: FileOption | undefined) {
    setRangeErr(null);
    setChoosePages(false);
    if (!file || file.status !== "ready") { setCoverage(null); return; }
    const { list, stored } = readCoverage(file.id);
    setCoverage({ fileId: file.id, list, stored });
    const pageCount = filePages(file);
    const r = isLong(file)
      ? defaultRange(file.pageChars, file.looseChars, pageCount, firstUnmade(list, file.pageChars, pageCount) ?? 1)
      : { from: 1, to: pageCount };
    setFields({ from: String(r.from), to: String(r.to) });
    setMode(modeOf(file.pageChars, file.looseChars, r));
  }

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
      if (type === "file") initRange(res.files.find((f) => f.id === id));
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
  // Page fields show for a long file, or after "Choose pages" on one that fits one set.
  const rangeFile = isLong(selectedFile) || (choosePages && canChoose(selectedFile)) ? selectedFile : undefined;
  const unit = unitOf(selectedFile);
  const quota = phase.kind === "message" ? phase.result.quota : opts?.quota;
  const made = coverage && rangeFile && coverage.fileId === rangeFile.id && coverage.stored ? coverage.list : [];

  // Coverage hint for the page fields (only while the numbers make a valid range).
  const pageCount = rangeFile ? filePages(rangeFile) : 1;
  const fieldsOk = rangeFile ? rangeError(fields.from, fields.to, pageCount, unit) === null : false;
  const fieldRange = { from: Number(fields.from), to: Number(fields.to) };
  const hint = rangeFile && fieldsOk ? rangeHint(rangeFile.pageChars, rangeFile.looseChars, fieldRange, unit) : null;
  const soFar = rangeFile ? madeSoFarText(made, pageCount, unit) : null;
  const overlap = fieldsOk ? overlapOf(made, fieldRange) : "none";
  const overlapText = overlap === "all"
    ? `You've made cards from these ${unit}s before. Cards you already have will be skipped.`
    : overlap === "some" ? "Cards you already have will be skipped." : null;
  const snap = hint?.kind === "sampled" ? hint.snap : null;
  const fromNum = /^\d+$/.test(fields.from.trim()) ? Math.min(Math.max(1, Number(fields.from)), pageCount) : 1;
  const picks = rangeFile ? quickPicks(rangeFile.pageChars, rangeFile.looseChars, pageCount, fromNum, unit) : [];
  const hintText = [soFar, hint?.text, snap ? `Want every passage? Use ${pagesSpoken(snap, unit)}.` : null, overlapText].filter(Boolean).join(" ");
  // Announce the hint 600 ms after the last keystroke, not on every digit.
  useEffect(() => {
    const t = setTimeout(() => setSpokenHint(hintText), 600);
    return () => clearTimeout(t);
  }, [hintText]);

  /** Merges a made (or already made) set into the file's pages covered and works out the progress to show. */
  function recordSet(file: FileOption, s: FileSeries): SeriesView {
    const u = unitOf(file);
    const prev = coverage?.fileId === file.id ? coverage : { fileId: file.id, ...readCoverage(file.id) };
    const list = mergeRanges(prev.list, s.range);
    setCoverage({ ...prev, list });
    writeCoverage(file.id, list);
    if (!s.covered) sampledFiles.current.add(file.id);
    const before = effectiveCoverage(prev.list, file.pageChars, s.pageCount);
    const after = effectiveCoverage(list, file.pageChars, s.pageCount);
    const done = coveredCount(after) >= s.pageCount;
    return {
      unit: u, pageCount: s.pageCount, range: s.range,
      text: coverageText(after, s.pageCount, u, sampledFiles.current.has(file.id)),
      before: coveredCount(before) / s.pageCount, value: Math.min(1, coveredCount(after) / s.pageCount),
      next: done ? null : s.next,
    };
  }

  async function generate() {
    if (!choice) return;
    const file = choice.type === "file" ? opts?.files.find((f) => f.id === choice.id) : undefined;
    const long = file && rangeFile?.id === file.id ? file : undefined;
    const range = long ? { from: Number(fields.from), to: Number(fields.to) } : null;
    setFocusMake(false);
    setPhase({ kind: "generating", range, unit: unitOf(file), sampled: hint?.kind === "sampled" || hint?.kind === "long_page" });
    setLine(0);
    const source = choice.type === "note"
      ? { type: "note" as const, id: choice.id }
      : range ? { type: "file" as const, id: choice.id, fromPage: range.from, toPage: range.to } : { type: "file" as const, id: choice.id };
    const res = await makeFlashcards({ subjectId, source, count }).catch(() => null);
    if (!res || !res.ok) {
      play("boop");
      setPhase(res && !res.ok ? { kind: "error", text: res.error } : { kind: "message", result: { status: "failed", quota: opts!.quota } });
      return;
    }
    const r = res.result;
    setOpts((o) => (o ? { ...o, quota: r.quota } : o));
    if (r.status === "made") {
      const series = long && r.series ? recordSet(long, r.series) : null;
      onMade?.(r.cards, r.quota);
      setPhase({ kind: "result", cards: r.cards, requested: r.requested, skipped: r.skipped, dropped: r.dropped, series });
      if (openRef.current) play("pop");
      else {
        const from = series ? ` from ${pagesText(series.range, series.unit)}` : "";
        toast.show(`${r.cards.length} new ${subjectName} cards${from} are ready`, { label: "See cards", href: `/subjects/${subjectId}/flashcards` });
      }
      router.refresh();
      return;
    }
    // "Already" and "all already in your deck" have no sound: nothing went wrong.
    if (r.status !== "already" && r.status !== "all_skipped") play("boop");
    setPhase({ kind: "message", result: r, series: (r.status === "already" || r.status === "all_skipped") && long && r.series ? recordSet(long, r.series) : null });
  }

  function submit() {
    if (rangeFile) {
      const err = rangeError(fields.from, fields.to, pageCount, unit);
      if (err) {
        setRangeErr(err);
        play("boop");
        (err.field === "from" ? fromRef : toRef).current?.focus();
        return;
      }
    }
    void generate();
  }

  /** "Next: pages 21–40": back to Step 1 with the same file and count, the server's next range filled in. */
  function goNext(next: PageRange) {
    setShowList(false);
    setFields({ from: String(next.from), to: String(next.to) });
    if (selectedFile) setMode(modeOf(selectedFile.pageChars, selectedFile.looseChars, next));
    setChoosePages(true);
    setRangeErr(null);
    setFocusMake(true);
    setPhase({ kind: "choose" });
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
          onChange={() => {
            play("click");
            setChoice({ type: kind, id });
            if (kind === "file") initRange(opts?.files.find((f) => f.id === id));
            else { setRangeErr(null); setChoosePages(false); }
          }}
        />
        <span aria-hidden="true">{kind === "note" ? "📝" : "📄"}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold">{title}</span>
          <span className="hint">{disabled ?? meta}</span>
        </span>
      </label>
    </li>
  );

  /** "Next: pages 7–12" with its quota hint, or the "tomorrow" hint when no goes are left. */
  const nextControl = (series: SeriesView | null | undefined, left: number) => {
    if (!series?.next) return null;
    const next = series.next;
    if (left === 0) {
      return <p className="hint sm:max-w-56">That was today&apos;s last go. {pagesTitle(next, series.unit)} {next.from === next.to ? "is" : "are"} next, tomorrow.</p>;
    }
    return (
      <div className="flex flex-col gap-1">
        <Button variant="primary" className="w-full sm:w-auto" aria-label={`Make the next set: ${pagesSpoken(next, series.unit)}`} onClick={() => goNext(next)}>
          Next: {pagesText(next, series.unit)}
        </Button>
        <p className="hint">{left === 1 ? "Uses your last go for today." : `Uses 1 of your ${left} goes left today.`}</p>
      </div>
    );
  };
  const hasNextButton = (series: SeriesView | null | undefined, left: number) => !!series?.next && left > 0;
  // Long files stack the buttons full width on phones, the primary one on top.
  const seriesRow = "flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:items-start sm:justify-end";

  let body: React.ReactNode;
  let title = "Make flashcards";
  if (phase.kind === "loading") {
    body = <div className="flex flex-col gap-2" aria-busy="true"><div className="skeleton h-10" /><div className="skeleton h-10" /><div className="skeleton h-10" /></div>;
  } else if (phase.kind === "error") {
    body = (<><p role="alert" className="error-text">{phase.text}</p><div className="flex justify-end"><Button onClick={close}>Close</Button></div></>);
  } else if (phase.kind === "choose" && opts) {
    const chosenTitle = choice?.type === "note" ? opts.notes.find((n) => n.id === choice.id)?.title : opts.files.find((f) => f.id === choice?.id)?.name;
    const Unit = unit === "slide" ? "Slide" : "Page";
    const describedBy = (field: "from" | "to") => [rangeErr?.field === field ? `${uid}-range-err` : "", `${uid}-range-hint`].filter(Boolean).join(" ");
    body = (
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}>
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
            <button type="button" className="min-h-11 font-bold underline underline-offset-2" onClick={() => { play("click"); setShowList(true); }}>Change source</button>
          </p>
        )}
        {canChoose(selectedFile) && (
          <p>
            <button
              type="button" className="min-h-11 font-bold underline underline-offset-2" aria-expanded={choosePages}
              onClick={() => {
                play("click");
                const pc = filePages(selectedFile);
                setRangeErr(null);
                if (!choosePages) {
                  setFields({ from: "1", to: String(pc) });
                  setMode(modeOf(selectedFile.pageChars, selectedFile.looseChars, { from: 1, to: pc }));
                }
                setChoosePages(!choosePages);
              }}
            >
              {choosePages ? "Use the whole file" : `Choose ${unit}s`}
            </button>
          </p>
        )}
        {rangeFile && (
          <fieldset className="flex flex-col gap-2">
            <legend className="label">{Unit}s</legend>
            <div className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor={`${uid}-from`}>First {unit}</label>
              <input
                id={`${uid}-from`} ref={fromRef} type="number" inputMode="numeric" className="input w-24" min={1} max={pageCount} value={fields.from}
                aria-invalid={rangeErr?.field === "from" || undefined} aria-describedby={describedBy("from")}
                onChange={(e) => {
                  const v = e.target.value;
                  setRangeErr(null);
                  // A new first page re-fits the last page by the pressed pick (or keeps the size); a typed last page is left alone.
                  const n = Number(v);
                  if (/^\d+$/.test(v.trim()) && n >= 1 && n <= pageCount) {
                    const r = refit(mode, rangeFile.pageChars, rangeFile.looseChars, pageCount, n);
                    setFields({ from: v, to: String(r.to) });
                  } else setFields((f) => ({ ...f, from: v }));
                }}
              />
              <span>to</span>
              <label className="sr-only" htmlFor={`${uid}-to`}>Last {unit}</label>
              <input
                id={`${uid}-to`} ref={toRef} type="number" inputMode="numeric" className="input w-24" min={1} max={pageCount} value={fields.to}
                aria-invalid={rangeErr?.field === "to" || undefined} aria-describedby={describedBy("to")}
                onChange={(e) => {
                  const v = e.target.value;
                  setRangeErr(null);
                  setFields((f) => ({ ...f, to: v }));
                  const r = { from: Number(fields.from), to: Number(v) };
                  if (rangeError(fields.from, v, pageCount, unit) === null) setMode(modeOf(rangeFile.pageChars, rangeFile.looseChars, r));
                }}
              />
              <span className="text-ink-soft">of {pageCount}</span>
            </div>
            {picks.length > 0 && (
              <div role="group" aria-label={`Quick pick for ${unit}s`} className="seg max-w-full flex-wrap" data-testid="quick-picks">
                {picks.map((p) => (
                  <button
                    key={p.id} type="button" aria-label={p.name}
                    aria-pressed={fieldsOk && fieldRange.from === p.range.from && fieldRange.to === p.range.to}
                    onClick={() => {
                      play("click");
                      setRangeErr(null);
                      setFields({ from: String(p.range.from), to: String(p.range.to) });
                      setMode(p.id === "fit" ? { kind: "fit" } : { kind: "size", size: p.range.to - p.range.from + 1 });
                    }}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            {rangeErr && <p id={`${uid}-range-err`} className="error-text w-fit">{rangeErr.text}</p>}
            <div id={`${uid}-range-hint`} className="hint" data-testid="range-hint">
              {soFar && <p>{soFar}</p>}
              {hint && <p>{hint.text}</p>}
              {snap && (
                <p>
                  Want every passage?{" "}
                  <button
                    type="button" className="min-h-11 font-bold text-ink underline underline-offset-2"
                    onClick={() => { play("click"); setFields((f) => ({ ...f, to: String(snap.to) })); setMode({ kind: "fit" }); }}
                  >
                    Use {pagesText(snap, unit)}
                  </button>
                </p>
              )}
              {overlapText && <p>{overlapText}</p>}
            </div>
            <p className="sr-only" role="status">{spokenHint}</p>
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
          <span className="hint">
            {rangeFile ? `Each set of ${unit}s uses one go, however many ${unit}s. Making cards from the same ${unit}s again is free.` : "Making cards from the same text again is free."}
          </span>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={!choice} autoFocus={focusMake}>Make flashcards</Button>
        </div>
      </form>
    );
  } else if (phase.kind === "generating") {
    const lines = phase.range ? [`${phase.sampled ? "Skimming" : "Reading"} ${pagesText(phase.range, phase.unit)}…`, ...LINES.slice(1)] : LINES;
    body = (
      <div className="flex flex-col items-center gap-4 py-4 text-center">
        <div className="relative h-28 w-40" aria-hidden="true">
          {[-3, 2, -1].map((r, i) => (
            <span key={i} className="sticker shuffle absolute inset-0" style={{ ["--r" as string]: `${r}deg`, animationDelay: `${i * 0.4}s`, top: i * 6, left: i * 6 }} />
          ))}
        </div>
        <p aria-hidden="true" className="font-bold">{lines[line]}</p>
        <p className="sr-only" role="status">
          {phase.range ? `Making flashcards from ${pagesSpoken(phase.range, phase.unit)}. This takes about 15 seconds.` : "Making flashcards. This takes about 15 seconds."}
        </p>
        <p className="hint">You can close this. We&apos;ll tell you when they&apos;re ready.</p>
        <Button variant="ghost" onClick={close}>Close</Button>
      </div>
    );
  } else if (phase.kind === "result") {
    const s = phase.series;
    const left = quota?.left ?? 0;
    const withNext = hasNextButton(s, left);
    const n = phase.cards.length;
    // The skipped line explains a shortfall itself; cards dropped for quality only show when fewer than half are left.
    const showFewer = phase.skipped === 0 && n < phase.requested && (phase.dropped === 0 || n < phase.requested / 2);
    title = `${phase.cards.length} new ${phase.cards.length === 1 ? "card" : "cards"}! ✨`;
    body = (
      <div className="flex flex-col gap-3">
        {phase.skipped > 0 && <p className="hint">Skipped {phase.skipped} {phase.skipped === 1 ? "card" : "cards"} you already have.</p>}
        {showFewer && <p className="hint">Your notes had enough for {phase.cards.length} {phase.cards.length === 1 ? "card" : "cards"}.</p>}
        <ul className="flex max-h-[45dvh] flex-col gap-2 overflow-y-auto pr-1" aria-label="New cards">
          {phase.cards.map((c) => <ResultRow key={c.id} card={c} onChange={onCardChange} />)}
        </ul>
        {s && (
          <div className="flex flex-col gap-1" data-testid="series-progress">
            <p className="font-bold">{s.text}</p>
            <ProgressBar value={s.value} from={s.before} />
          </div>
        )}
        {quota && <div><QuotaChip quota={quota} /></div>}
        <div className={s ? seriesRow : "flex flex-wrap justify-end gap-2"}>
          <Button variant="ghost" className={s ? "w-full sm:w-auto" : ""} onClick={close}>Done</Button>
          <Link href={`/subjects/${subjectId}/review`} className={`btn ${withNext ? "" : "btn-primary"} ${s ? "w-full sm:w-auto" : ""}`} onClick={() => play("click")}>Start reviewing</Link>
          {nextControl(s, left)}
        </div>
      </div>
    );
  } else if (phase.kind === "message") {
    const r = phase.result;
    const s = phase.series;
    const withNext = hasNextButton(s, r.quota.left);
    const msg = {
      too_short: { emoji: "✏️", text: r.status === "too_short" && r.sourceType === "file" ? "This file doesn't have enough text for flashcards." : "This note is a bit short for flashcards. Add a paragraph or two and try again." },
      limit: { emoji: "🌙", text: `You've made all ${r.quota.limit} sets of flashcards for today. More tomorrow! You can still add cards by hand.` },
      allowance: { emoji: "🌙", text: "Today's free AI allowance is used up. Try again tomorrow. Your notes and cards are safe." },
      already: {
        emoji: "📚",
        text: s ? `You already made cards from ${pagesText(s.range, s.unit)}. Try the next ${s.unit}s or another source.` : "You already made cards from this version of the note. Change the note or pick another source.",
      },
      all_skipped: {
        emoji: "🗂️",
        text: `Every card from ${s ? pagesText(s.range, s.unit) : "these pages"} is already in your deck. Try some new ${s?.unit ?? "page"}s. This one didn't use up a go.`,
      },
      failed: { emoji: "🌀", text: "The card maker got muddled. Try again. This one didn't use up a go." },
      not_configured: { emoji: "🔌", text: "AI isn't set up yet, so flashcards can't be made right now. You can still add cards by hand." },
    }[r.status];
    body = (
      <div className="flex flex-col gap-4">
        <div className="sticker-flat flex items-start gap-3 p-4">
          <span className="text-3xl" aria-hidden="true">{msg.emoji}</span>
          <p>{msg.text}</p>
        </div>
        {r.status !== "already" && r.status !== "not_configured" && <div><QuotaChip quota={r.quota} /></div>}
        <div className={withNext ? seriesRow : "flex flex-wrap justify-end gap-2"}>
          {r.status === "too_short" && <Button variant="primary" onClick={() => { setShowList(true); setPhase({ kind: "choose" }); }}>Pick another source</Button>}
          {(r.status === "limit" || r.status === "not_configured") && onAddByHand && <Button variant="primary" onClick={() => { close(); onAddByHand(); }}>Add a card by hand</Button>}
          {r.status === "already" && (
            <>
              <Button className={withNext ? "w-full sm:w-auto" : ""} onClick={() => { setShowList(true); setPhase({ kind: "choose" }); }}>Pick another source</Button>
              <Link href={`/subjects/${subjectId}/flashcards`} className={`btn ${withNext ? "w-full sm:w-auto" : "btn-primary"}`} onClick={() => { play("click"); close(); }}>Show those cards</Link>
              {withNext && nextControl(s, r.quota.left)}
            </>
          )}
          {r.status === "failed" && <Button variant="primary" onClick={() => void generate()} disabled={!choice}>Try again</Button>}
          {r.status === "all_skipped" && (
            <>
              <Button className={withNext ? "w-full sm:w-auto" : ""} onClick={close}>Close</Button>
              {withNext && nextControl(s, r.quota.left)}
            </>
          )}
          {(r.status === "limit" || r.status === "allowance" || r.status === "not_configured") && <Button onClick={close}>Close</Button>}
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
