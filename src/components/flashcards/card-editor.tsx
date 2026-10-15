"use client";
import { useEffect, useId, useRef, useState } from "react";
import { CARD_BACK_MAX, CARD_FRONT_MAX } from "@/lib/validation";
import { useSound } from "../sound-provider";
import { Button } from "../ui/button";

function Counter({ value, max }: { value: string; max: number }) {
  if (value.length < max * 0.8) return null;
  return <span className="hint" aria-live="polite">{value.length} / {max}</span>;
}

function AutoTextarea(props: { id: string; value: string; max: number; invalid: boolean; describedBy?: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 4}px`;
  }, [props.value]);
  useEffect(() => { if (props.autoFocus) ref.current?.focus(); }, [props.autoFocus]);
  return (
    <textarea
      ref={ref} id={props.id} rows={2} maxLength={props.max} value={props.value} className="input resize-none"
      aria-invalid={props.invalid || undefined} aria-describedby={props.describedBy} required
      onChange={(e) => props.onChange(e.target.value)}
    />
  );
}

/**
 * Inline add/edit form (flashcards.md "Add a card / edit a card"). Ctrl/Cmd+Enter saves,
 * Esc cancels (asking first only if something was typed).
 */
export function CardEditor({ initial, onSave, onCancel, saveLabel = "Save card" }: {
  initial?: { front: string; back: string };
  onSave: (front: string, back: string) => Promise<string | null>;
  onCancel: () => void;
  saveLabel?: string;
}) {
  const [front, setFront] = useState(initial?.front ?? "");
  const [back, setBack] = useState(initial?.back ?? "");
  const [errors, setErrors] = useState<{ front?: string; back?: string; form?: string }>({});
  const [saving, setSaving] = useState(false);
  const [askDiscard, setAskDiscard] = useState(false);
  const { play } = useSound();
  const uid = useId();
  const changed = front !== (initial?.front ?? "") || back !== (initial?.back ?? "");

  async function save() {
    const e: typeof errors = {};
    if (!front.trim()) e.front = "Add some text to the front.";
    if (!back.trim()) e.back = "Add some text to the back.";
    setErrors(e);
    if (e.front || e.back) { play("boop"); return; }
    setSaving(true);
    const err = await onSave(front.trim(), back.trim()).catch(() => "Couldn't save. Try again.");
    setSaving(false);
    if (err) { setErrors({ form: err }); play("boop"); }
  }

  function cancel() {
    if (changed && !askDiscard) { setAskDiscard(true); return; }
    onCancel();
  }

  return (
    <div
      className="flex flex-col gap-3"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void save(); }
        if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); cancel(); }
      }}
    >
      <div className="field">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={`${uid}-front`}>Front</label>
          <Counter value={front} max={CARD_FRONT_MAX} />
        </div>
        <AutoTextarea id={`${uid}-front`} value={front} max={CARD_FRONT_MAX} invalid={!!errors.front} describedBy={errors.front ? `${uid}-fe` : undefined} onChange={setFront} autoFocus />
        {errors.front && <p id={`${uid}-fe`} className="error-text">{errors.front}</p>}
      </div>
      <div className="field">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={`${uid}-back`}>Back</label>
          <Counter value={back} max={CARD_BACK_MAX} />
        </div>
        <AutoTextarea id={`${uid}-back`} value={back} max={CARD_BACK_MAX} invalid={!!errors.back} describedBy={errors.back ? `${uid}-be` : undefined} onChange={setBack} />
        {errors.back && <p id={`${uid}-be`} className="error-text">{errors.back}</p>}
      </div>
      {errors.form && <p role="alert" className="error-text">{errors.form}</p>}
      {askDiscard ? (
        <div role="group" aria-label="Discard changes?" className="flex flex-wrap items-center gap-2">
          <span className="font-bold">Discard changes?</span>
          <Button size="sm" variant="danger" onClick={onCancel}>Discard</Button>
          <Button size="sm" variant="ghost" onClick={() => setAskDiscard(false)}>Keep editing</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" sound={null} disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : saveLabel}</Button>
          <Button variant="ghost" onClick={cancel}>Cancel</Button>
        </div>
      )}
    </div>
  );
}
