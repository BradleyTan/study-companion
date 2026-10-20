"use client";
import { useId, useState } from "react";
import { dayOf, durationLabel, parseTimeValue, timeValue } from "@/lib/timetable/dates";
import { defaultTitle, KIND_LABEL, LOCATION_MAX, SLOT_ERRORS, SLOT_KINDS, slotError, slotTitle, TITLE_MAX, type EditScope, type SlotKind } from "@/lib/timetable/slots";
import type { SlotUndo } from "@/lib/validation";
import { createSlot, deleteSlot, editSlot } from "@/server/actions/timetable";
import { useSound } from "../sound-provider";
import { Button } from "../ui/button";
import { ResponsiveSheet } from "../ui/responsive-sheet";
import { lastSubject, rememberSubject, type FormStart, type Slot, type TtSubject } from "./model";

export const SAVE_FAILED = "Couldn't save that slot. Try again.";

/** End time from the input: "00:00" after a start means midnight (24:00). */
function endFrom(v: string, start: number | null): number | null {
  const m = parseTimeValue(v);
  if (m === null) return null;
  return m === 0 && start !== null && start > 0 ? 1440 : m;
}

/**
 * "New slot" / "Edit slot" (timetable.md "Create / edit form"): everything a drag can do, by
 * keyboard. Editing one week of a weekly slot asks "Just this week" or "Every week".
 */
export function SlotForm({ start, subjects, onClose, onSaved, onDeleted }: {
  start: FormStart | null;
  subjects: TtSubject[];
  onClose: () => void;
  onSaved: (slots: Slot[], info: { date: string; mode: "new" | "edit" }) => void;
  onDeleted: (slots: Slot[], undo: SlotUndo, title: string) => void;
}) {
  return (
    <ResponsiveSheet open={!!start} onClose={onClose} title={start?.mode === "edit" ? "Edit slot" : "New slot"} testId="slot-form">
      {start && <FormBody key={JSON.stringify(start.mode === "edit" ? [start.slot.id, start.occDate, start.slot.updatedAt] : start)} start={start} subjects={subjects} onClose={onClose} onSaved={onSaved} onDeleted={onDeleted} />}
    </ResponsiveSheet>
  );
}

function FormBody({ start, subjects, onClose, onSaved, onDeleted }: {
  start: FormStart; subjects: TtSubject[]; onClose: () => void;
  onSaved: (slots: Slot[], info: { date: string; mode: "new" | "edit" }) => void;
  onDeleted: (slots: Slot[], undo: SlotUndo, title: string) => void;
}) {
  const { play } = useSound();
  const uid = useId();
  const edit = start.mode === "edit" ? start : null;
  const weeklySeries = edit?.slot.recurrence === "weekly";
  const known = (id: string | null | undefined) => (id && subjects.some((s) => s.id === id) ? id : null);
  const firstSubject = edit ? known(edit.slot.subjectId) : start.mode === "new" && start.subjectId !== undefined ? known(start.subjectId) : known(lastSubject());

  const [kind, setKind] = useState<SlotKind>(edit ? edit.slot.kind : (start.mode === "new" && start.kind) || "class");
  const [subjectId, setSubjectId] = useState<string | null>(firstSubject);
  const [title, setTitle] = useState(edit?.slot.title ?? "");
  const [date, setDate] = useState(start.date);
  const [startV, setStartV] = useState(timeValue(start.startMin));
  const [endV, setEndV] = useState(timeValue(start.endMin));
  const [repeats, setRepeats] = useState<"weekly" | "none">(edit ? edit.slot.recurrence : "weekly");
  const [until, setUntil] = useState(edit?.slot.repeatUntil ?? "");
  const [location, setLocation] = useState(edit?.slot.location ?? "");
  const [scope, setScope] = useState<EditScope>("this");
  const [error, setError] = useState<{ field: "end" | "until" | "form"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const subjectName = subjects.find((s) => s.id === subjectId)?.name ?? null;
  const startMin = parseTimeValue(startV);
  const endMin = endFrom(endV, startMin);
  const length = startMin !== null && endMin !== null && endMin > startMin ? durationLabel(endMin - startMin) : null;
  // "Just this week" makes a one-off copy: no repeat options for it.
  const showRepeats = !(weeklySeries && scope === "this");
  const shownTitle = edit ? slotTitle(edit.slot, subjects.find((s) => s.id === edit.slot.subjectId)?.name ?? null) : "";

  const fail = (field: "end" | "until" | "form", text: string) => { setError({ field, text }); play("boop"); };

  async function save() {
    if (startMin === null || endMin === null) return fail("end", "Pick a start and an end time.");
    if (!date || !Number.isFinite(dayOf(date))) return fail("form", "Pick a day.");
    const rep = showRepeats ? repeats : "none";
    const untilV = rep === "weekly" && until ? until : null;
    const bad = slotError({ startMin, endMin, startDate: date, repeatUntil: untilV, recurrence: rep });
    if (bad) return fail(bad === SLOT_ERRORS.untilBefore ? "until" : "end", bad);
    const slot = { kind, subjectId, title, location, date, startMin, endMin, repeats: rep, until: untilV };
    setBusy(true);
    setError(null);
    try {
      const res = edit
        ? await editSlot({ id: edit.slot.id, date: edit.occDate, scope: weeklySeries ? scope : "all", slot })
        : await createSlot(slot);
      if (!res.ok) return fail(/until/i.test(res.error) ? "until" : /end|hours/i.test(res.error) ? "end" : "form", res.error);
      rememberSubject(subjectId);
      play("pop");
      onSaved(res.slots, { date, mode: edit ? "edit" : "new" });
    } catch {
      fail("form", SAVE_FAILED);
    } finally {
      setBusy(false);
    }
  }

  async function remove(sc: EditScope) {
    if (!edit) return;
    setBusy(true);
    try {
      const res = await deleteSlot({ id: edit.slot.id, date: edit.occDate, scope: sc });
      if (!res.ok) return fail("form", res.error);
      play("tear");
      onDeleted(res.slots, res.undo, shownTitle);
    } catch {
      fail("form", "Couldn't delete that slot. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const err = (f: "end" | "until") => (error?.field === f ? `${uid}-err` : undefined);
  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <fieldset className="field">
        <legend className="label mb-1">What is it?</legend>
        <div className="seg self-start">
          {SLOT_KINDS.map((k) => (
            <label key={k}>
              <input type="radio" className="sr-only" name={`${uid}-kind`} value={k} checked={kind === k} onChange={() => { play("click"); setKind(k); }} />
              {KIND_LABEL[k]}
            </label>
          ))}
        </div>
      </fieldset>

      {weeklySeries && (
        <fieldset className="field">
          <legend className="label mb-1">Change</legend>
          <div className="seg self-start">
            <label><input type="radio" className="sr-only" name={`${uid}-scope`} checked={scope === "this"} onChange={() => { play("click"); setScope("this"); }} />Just this week</label>
            <label><input type="radio" className="sr-only" name={`${uid}-scope`} checked={scope === "all"} onChange={() => { play("click"); setScope("all"); }} />Every week</label>
          </div>
        </fieldset>
      )}

      <div className="field">
        <label htmlFor={`${uid}-subject`}>Subject</label>
        <select id={`${uid}-subject`} className="input" value={subjectId ?? ""} onChange={(e) => setSubjectId(e.target.value || null)}>
          {subjects.map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}
          <option value="">No subject</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${uid}-title`}>Title <span className="hint font-normal">(optional)</span></label>
        <input id={`${uid}-title`} className="input" value={title} maxLength={TITLE_MAX} placeholder={defaultTitle(kind, subjectName)} onChange={(e) => setTitle(e.target.value)} />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="field">
          <label htmlFor={`${uid}-date`}>Day</label>
          <input id={`${uid}-date`} type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-start`}>Start</label>
          <input id={`${uid}-start`} type="time" step={900} className="input" required value={startV} onChange={(e) => setStartV(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${uid}-end`}>End {length && <span className="hint font-normal" data-testid="slot-length">{length}</span>}</label>
          <input id={`${uid}-end`} type="time" step={900} className="input" required value={endV} aria-invalid={error?.field === "end" || undefined} aria-describedby={err("end")} onChange={(e) => setEndV(e.target.value)} />
        </div>
      </div>
      {error?.field === "end" && <p id={`${uid}-err`} className="error-text" role="alert">{error.text}</p>}

      {showRepeats && (
        <fieldset className="field">
          <legend className="label mb-1">Repeats</legend>
          <div className="flex flex-wrap items-end gap-3">
            <div className="seg">
              <label><input type="radio" className="sr-only" name={`${uid}-rep`} checked={repeats === "weekly"} onChange={() => { play("click"); setRepeats("weekly"); }} />Every week</label>
              <label><input type="radio" className="sr-only" name={`${uid}-rep`} checked={repeats === "none"} onChange={() => { play("click"); setRepeats("none"); }} />Just once</label>
            </div>
            {repeats === "weekly" && (
              <div className="field min-w-40 flex-1">
                <label htmlFor={`${uid}-until`}>Until <span className="hint font-normal">(optional)</span></label>
                <input id={`${uid}-until`} type="date" className="input" value={until} min={date} aria-invalid={error?.field === "until" || undefined} aria-describedby={err("until")} onChange={(e) => setUntil(e.target.value)} />
              </div>
            )}
          </div>
          {error?.field === "until" && <p id={`${uid}-err`} className="error-text mt-2" role="alert">{error.text}</p>}
        </fieldset>
      )}

      <div className="field">
        <label htmlFor={`${uid}-loc`}>Location <span className="hint font-normal">(optional)</span></label>
        <input id={`${uid}-loc`} className="input" value={location} maxLength={LOCATION_MAX} onChange={(e) => setLocation(e.target.value)} />
      </div>

      {error?.field === "form" && <p className="error-text" role="alert">{error.text}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="primary" sound={null} disabled={busy}>{busy ? "Saving…" : "Save slot"}</Button>
        <Button onClick={onClose}>Cancel</Button>
        {edit && !confirmDelete && <Button variant="danger" className="sm:ml-auto" onClick={() => setConfirmDelete(true)}>Delete slot</Button>}
      </div>
      {edit && confirmDelete && (
        <div role="group" aria-label="Confirm delete" className="flex flex-col gap-2 rounded-lg border-2 border-ink p-3">
          <p className="font-bold">Delete {shownTitle}?</p>
          <div className="flex flex-wrap gap-2">
            {weeklySeries ? (
              <>
                <Button variant="danger" sound={null} disabled={busy} onClick={() => void remove("this")}>Just this week</Button>
                <Button variant="danger" sound={null} disabled={busy} onClick={() => void remove("all")}>Every week</Button>
              </>
            ) : (
              <Button variant="danger" sound={null} disabled={busy} onClick={() => void remove("all")}>Delete</Button>
            )}
            <Button onClick={() => setConfirmDelete(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </form>
  );
}
