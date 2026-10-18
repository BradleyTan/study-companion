"use client";
import { useEffect, useState, type RefObject } from "react";
import {
  modeOf, pagesSpoken, pagesText, quickPicks, rangeError, rangeHint, refit, type PageRange, type PageUnit, type RangeNoun, type RefitMode,
} from "@/lib/page-range";
import { useSound } from "../sound-provider";

export type RangeFields = { from: string; to: string };
export type RangeFieldError = { field: "from" | "to"; text: string } | null;

/**
 * The page-range fields of the Make flashcards and Make a quiz dialogs (flashcards.md "Long
 * files", quiz-builder.md "Page ranges"): "Pages [1] to [20] of 42", quick picks, the coverage
 * hint (spoken 600 ms after the last keystroke) and inline validation. Each dialog passes its
 * own character budget and wording; `before` / `after` add dialog-specific hint lines.
 */
export function PageRangeFields({
  uid, file, pageCount, unit, budget, noun, fields, setFields, mode, setMode, error, setError, fromRef, toRef, before, after,
}: {
  uid: string;
  file: { pageChars: number[] | null; looseChars: number };
  pageCount: number;
  unit: PageUnit;
  budget: number;
  noun: RangeNoun;
  fields: RangeFields;
  setFields: (f: RangeFields | ((f: RangeFields) => RangeFields)) => void;
  mode: RefitMode;
  setMode: (m: RefitMode) => void;
  error: RangeFieldError;
  setError: (e: RangeFieldError) => void;
  fromRef: RefObject<HTMLInputElement | null>;
  toRef: RefObject<HTMLInputElement | null>;
  before?: string | null;
  after?: string | null;
}) {
  const { play } = useSound();
  const [spoken, setSpoken] = useState("");
  const Unit = unit === "slide" ? "Slide" : "Page";
  const fieldsOk = rangeError(fields.from, fields.to, pageCount, unit) === null;
  const fieldRange: PageRange = { from: Number(fields.from), to: Number(fields.to) };
  const hint = fieldsOk ? rangeHint(file.pageChars, file.looseChars, fieldRange, unit, budget, noun) : null;
  const snap = hint?.kind === "sampled" ? hint.snap : null;
  const fromNum = /^\d+$/.test(fields.from.trim()) ? Math.min(Math.max(1, Number(fields.from)), pageCount) : 1;
  const picks = quickPicks(file.pageChars, file.looseChars, pageCount, fromNum, unit, budget);
  const hintText = [before, hint?.text, snap ? `Want every passage? Use ${pagesSpoken(snap, unit)}.` : null, after].filter(Boolean).join(" ");
  // Announce the hint 600 ms after the last keystroke, not on every digit.
  useEffect(() => {
    const t = setTimeout(() => setSpoken(hintText), 600);
    return () => clearTimeout(t);
  }, [hintText]);
  const describedBy = (field: "from" | "to") => [error?.field === field ? `${uid}-range-err` : "", `${uid}-range-hint`].filter(Boolean).join(" ");

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="label">{Unit}s</legend>
      <div className="flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor={`${uid}-from`}>First {unit}</label>
        <input
          id={`${uid}-from`} ref={fromRef} type="number" inputMode="numeric" className="input w-24" min={1} max={pageCount} value={fields.from}
          aria-invalid={error?.field === "from" || undefined} aria-describedby={describedBy("from")}
          onChange={(e) => {
            const v = e.target.value;
            setError(null);
            // A new first page re-fits the last page by the pressed pick (or keeps the size); a typed last page is left alone.
            const n = Number(v);
            if (/^\d+$/.test(v.trim()) && n >= 1 && n <= pageCount) {
              const r = refit(mode, file.pageChars, file.looseChars, pageCount, n, budget);
              setFields({ from: v, to: String(r.to) });
            } else setFields((f) => ({ ...f, from: v }));
          }}
        />
        <span>to</span>
        <label className="sr-only" htmlFor={`${uid}-to`}>Last {unit}</label>
        <input
          id={`${uid}-to`} ref={toRef} type="number" inputMode="numeric" className="input w-24" min={1} max={pageCount} value={fields.to}
          aria-invalid={error?.field === "to" || undefined} aria-describedby={describedBy("to")}
          onChange={(e) => {
            const v = e.target.value;
            setError(null);
            setFields((f) => ({ ...f, to: v }));
            const r = { from: Number(fields.from), to: Number(v) };
            if (rangeError(fields.from, v, pageCount, unit) === null) setMode(modeOf(file.pageChars, file.looseChars, r, budget));
          }}
        />
        <span className="text-ink-soft">of {pageCount}</span>
      </div>
      {picks.length > 0 && (
        <div role="group" aria-label={`Quick pick for ${unit}s`} className="seg flex w-full" data-testid="quick-picks">
          {picks.map((p) => (
            <button
              key={p.id} type="button" aria-label={p.name} className="flex-1 whitespace-nowrap px-2"
              aria-pressed={fieldsOk && fieldRange.from === p.range.from && fieldRange.to === p.range.to}
              onClick={() => {
                play("click");
                setError(null);
                setFields({ from: String(p.range.from), to: String(p.range.to) });
                setMode(p.id === "fit" ? { kind: "fit" } : { kind: "size", size: p.range.to - p.range.from + 1 });
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      )}
      {error && <p id={`${uid}-range-err`} className="error-text w-fit">{error.text}</p>}
      <div id={`${uid}-range-hint`} className="hint" data-testid="range-hint">
        {before && <p>{before}</p>}
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
        {after && <p>{after}</p>}
      </div>
      <p className="sr-only" role="status">{spoken}</p>
    </fieldset>
  );
}
