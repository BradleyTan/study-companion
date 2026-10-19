"use client";
import { useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { dayMonth, dayOf, weekStartOf } from "@/lib/timetable/dates";
import { IMPORT_MAX_BYTES } from "@/lib/timetable/limits";
import { weekItems, type SlotLike } from "@/lib/timetable/slots";
import { addImport, previewImport, type ImportPreview } from "@/server/actions/timetable";
import { useSound } from "../sound-provider";
import { Button } from "../ui/button";
import { ResponsiveSheet } from "../ui/responsive-sheet";
import { subjectStyle } from "../ui/subject-style";
import { usePhone } from "../ui/use-media";
import type { Slot, TtSubject } from "./model";

type Step = { kind: "choose"; error: string | null } | { kind: "reading" } | { kind: "preview"; preview: ImportPreview };
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export type ImportDone = { slots: Slot[]; batch: string; count: number; firstDate: string };

/** "Import your timetable" (timetable.md): choose an .ics file, read it on the server, preview, add. */
export function ImportDialog({ open, onClose, subjects, weekStart, onDone }: {
  open: boolean; onClose: () => void; subjects: TtSubject[]; weekStart: "mon" | "sun"; onDone: (d: ImportDone) => void;
}) {
  return (
    <ResponsiveSheet open={open} onClose={onClose} title="Import your timetable" wide testId="import-dialog">
      {open && <ImportBody subjects={subjects} weekStart={weekStart} onClose={onClose} onDone={onDone} />}
    </ResponsiveSheet>
  );
}

function ImportBody({ subjects, weekStart, onClose, onDone }: { subjects: TtSubject[]; weekStart: "mon" | "sun"; onClose: () => void; onDone: (d: ImportDone) => void }) {
  const { play } = useSound();
  const [step, setStep] = useState<Step>({ kind: "choose", error: null });
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const uid = useId();

  async function read(file: File | undefined) {
    if (!file) return;
    const fail = (error: string) => { setStep({ kind: "choose", error }); play("boop"); };
    if (file.size > IMPORT_MAX_BYTES) return fail("That file is over 1 MB.");
    if (!/\.ics$/i.test(file.name) && file.type !== "text/calendar") return fail("That isn't a calendar file. Look for a file ending in .ics.");
    setStep({ kind: "reading" });
    const form = new FormData();
    form.set("file", file);
    try {
      const r = await previewImport(form);
      if (!r.ok) return fail(r.error);
      setStep({ kind: "preview", preview: r.preview });
    } catch {
      fail("Something went wrong reading that file. Try exporting it again.");
    }
  }

  if (step.kind === "reading") {
    return <p className="py-8 text-center text-lg font-bold" role="status"><span className="motion-safe:animate-pulse">Reading your timetable…</span></p>;
  }
  if (step.kind === "preview") {
    return <Preview preview={step.preview} subjects={subjects} weekStart={weekStart} onBack={() => setStep({ kind: "choose", error: null })} onClose={onClose} onDone={onDone} />;
  }
  return (
    <div className="flex flex-col gap-4">
      <p>Most uni timetable pages have an &apos;Export&apos;, &apos;Subscribe&apos; or &apos;Download to calendar&apos; option. Save the .ics file and choose it here.</p>
      <div
        className={`flex flex-col items-center gap-2 rounded-lg border-[2.5px] border-dashed border-ink p-6 text-center ${drag ? "bg-highlight text-[var(--on-colour)]" : "bg-card/70"}`}
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); void read(e.dataTransfer.files[0]); }}
        data-testid="import-drop"
      >
        <p className="font-bold">Drop your .ics file here, or{" "}
          <label htmlFor={`${uid}-file`} className="cursor-pointer underline underline-offset-4">choose a file</label>
        </p>
        <p className="hint">Calendar file (.ics), up to 1 MB</p>
        <input
          ref={fileRef} id={`${uid}-file`} type="file" accept=".ics,text/calendar" className="sr-only" data-testid="import-file"
          onChange={(e) => { void read(e.target.files?.[0]); e.target.value = ""; }}
        />
        <Button size="sm" onClick={() => fileRef.current?.click()}>Choose a file</Button>
      </div>
      {step.error && <p className="error-text" role="alert">{step.error}</p>}
      <div><Button onClick={onClose}>Cancel</Button></div>
    </div>
  );
}

function Preview({ preview, subjects, weekStart, onBack, onClose, onDone }: {
  preview: ImportPreview; subjects: TtSubject[]; weekStart: "mon" | "sun"; onBack: () => void; onClose: () => void; onDone: (d: ImportDone) => void;
}) {
  const { play } = useSound();
  const phone = usePhone();
  const uid = useId();
  const [ticked, setTicked] = useState<Set<string>>(() => new Set(preview.groups.map((g) => g.name)));
  const [subjectFor, setSubjectFor] = useState<Record<string, string | null>>(() => Object.fromEntries(preview.groups.map((g) => [g.name, g.subjectId])));
  const reimport = preview.classes.some((c) => c.existing) || preview.removable > 0;
  const [replace, setReplace] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = preview.classes.filter((c) => ticked.has(c.group));
  const meetings = chosen.reduce((n, c) => n + c.dates, 0);
  const allMeetings = preview.classes.reduce((n, c) => n + c.dates, 0);
  const updated = replace ? chosen.filter((c) => c.existing).length : 0;
  const fresh = chosen.filter((c) => !c.existing).length;
  const removed = replace ? preview.removable : 0;
  const range = preview.firstDate && preview.lastDate ? `, ${dayMonth(dayOf(preview.firstDate))} – ${dayMonth(dayOf(preview.lastDate))}` : "";
  const subjectById = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);

  async function add() {
    setBusy(true);
    setError(null);
    try {
      const r = await addImport({
        classes: chosen.map((c) => ({
          key: c.key, subjectId: subjectFor[c.group] ?? null, title: c.title, location: c.location, startDate: c.startDate,
          startMin: c.startMin, endMin: c.endMin, recurrence: c.recurrence, repeatUntil: c.repeatUntil, skipDates: c.skipDates,
        })),
        replace,
        fileKeys: preview.classes.map((c) => c.key),
      });
      if (!r.ok) { setError(r.error); play("boop"); return; }
      play("pop");
      onDone({ slots: r.slots, batch: r.batch, count: meetings, firstDate: r.firstDate });
    } catch {
      setError("Couldn't add those classes. Try again.");
      play("boop");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p data-testid="import-summary">
        We found <strong>{plural(allMeetings, "class", "classes")}</strong> in <strong>{plural(preview.groups.length, "group")}</strong>{range}.
      </p>
      {preview.leftOut && <p className="hint" data-testid="import-left-out">{preview.leftOut}</p>}
      {preview.fileZone && preview.fileZone !== preview.timezone && (
        <p className="hint">These times are in {preview.fileZone}. They&apos;re shown in your time zone ({preview.timezone}).</p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">Classes found in your file</caption>
          <thead className="sr-only sm:not-sr-only">
            <tr className="border-b-2 border-ink">
              <th scope="col" className="w-11 p-1"><span className="sr-only">Include</span></th>
              <th scope="col" className="p-1">Group</th>
              <th scope="col" className="p-1">Subject</th>
            </tr>
          </thead>
          <tbody>
            {preview.groups.map((g, i) => (
              <tr key={g.name} className="border-b border-[var(--rule)] align-top" data-testid="import-group">
                <td className="p-1">
                  <input
                    id={`${uid}-g${i}`} type="checkbox" className="size-6 accent-[var(--highlight)]" checked={ticked.has(g.name)}
                    aria-label={`Include ${g.name}`}
                    onChange={(e) => {
                      play("click");
                      setTicked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(g.name); else n.delete(g.name); return n; });
                    }}
                  />
                </td>
                <td className="p-1">
                  <label htmlFor={`${uid}-g${i}`} className="font-bold">{g.name}</label>
                  <div className="hint">{g.when}{g.location ? ` · ${g.location}` : ""}</div>
                </td>
                <td className="p-1">
                  <select
                    className="input min-w-36" aria-label={`Subject for ${g.name}`} value={subjectFor[g.name] ?? ""}
                    onChange={(e) => setSubjectFor((cur) => ({ ...cur, [g.name]: e.target.value || null }))}
                  >
                    {subjects.map((s) => <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>)}
                    <option value="">No subject</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!phone && <MiniWeek preview={preview} chosen={chosen} subjectFor={subjectFor} subjectById={subjectById} weekStart={weekStart} />}

      {reimport && (
        <div className="flex flex-col gap-1">
          <label className="flex min-h-11 items-center gap-2 font-bold">
            <input type="checkbox" className="size-6 accent-[var(--highlight)]" checked={replace} onChange={(e) => { play("click"); setReplace(e.target.checked); }} />
            Replace my previous import
          </label>
          <p className="hint" data-testid="import-changes">{updated} updated, {fresh} new, {removed} removed</p>
        </div>
      )}

      {error && <p className="error-text" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" sound={null} disabled={busy || chosen.length === 0} onClick={() => void add()}>
          {busy ? "Adding…" : `Add ${plural(meetings, "class", "classes")}`}
        </Button>
        <Button onClick={onBack}>Back</Button>
        <Button onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

/** The first full imported week, drawn small (laptop/tablet only). */
function MiniWeek({ preview, chosen, subjectFor, subjectById, weekStart }: {
  preview: ImportPreview; chosen: ImportPreview["classes"]; subjectFor: Record<string, string | null>; subjectById: Map<string, TtSubject>; weekStart: "mon" | "sun";
}) {
  if (!preview.firstDate || !chosen.length) return null;
  const first = dayOf(preview.firstDate);
  const ws = weekStartOf(first, weekStart);
  const firstWeek = ws === first ? ws : ws + 7;
  const asSlots: (SlotLike & { group: string })[] = chosen.map((c) => ({
    id: c.key, group: c.group, subjectId: null, kind: "class", title: c.title, location: c.location, tz: preview.timezone,
    startDate: c.startDate, startMin: c.startMin, endMin: c.endMin, recurrence: c.recurrence, repeatUntil: c.repeatUntil, skipDates: c.skipDates,
  }));
  let week = weekItems(asSlots, firstWeek, preview.timezone);
  let shown = firstWeek;
  if (!week.some((d) => d.length)) { week = weekItems(asSlots, ws, preview.timezone); shown = ws; }
  const all = week.flat();
  if (!all.length) return null;
  const lo = Math.min(7 * 60, ...all.map((i) => i.startMin));
  const hi = Math.max(19 * 60, ...all.map((i) => i.endMin));
  const scale = (m: number) => ((m - lo) / (hi - lo)) * 100;
  return (
    <figure className="flex flex-col gap-1" aria-hidden="true" data-testid="mini-week">
      <figcaption className="hint">Week of {dayMonth(shown)}</figcaption>
      <div className="mini-week">
        {week.map((list, i) => (
          <div key={i} className="mini-day">
            {list.map((it) => {
              const sid = subjectFor[it.slot.group];
              const s = sid ? subjectById.get(sid) : undefined;
              const style: CSSProperties = { ...(s ? subjectStyle(s.colour) : { ["--subject" as string]: "var(--card)" }), top: `${scale(it.startMin)}%`, height: `${scale(it.endMin) - scale(it.startMin)}%` };
              return <div key={`${it.slot.id}-${it.occ.date}`} className="mini-slot" style={style} />;
            })}
          </div>
        ))}
      </div>
    </figure>
  );
}
