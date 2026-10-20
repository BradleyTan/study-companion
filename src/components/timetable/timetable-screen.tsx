"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { dayOf, instantOf, isoOf, localOf, longDate, todayIn, weekLabel, weekStartOf, weekdayShort, ymd } from "@/lib/timetable/dates";
import { movedLine, nearestOutside, nextLabel } from "@/lib/timetable/grid";
import { slotTitle, weekItems, type EditScope } from "@/lib/timetable/slots";
import type { SlotUndo } from "@/lib/validation";
import { deleteSlot, editSlot, undoImport, undoSlotDelete } from "@/server/actions/timetable";
import { useSound } from "../sound-provider";
import { useTimer } from "../timer/timer-provider";
import { useActionToast } from "../ui/action-toast";
import { Button } from "../ui/button";
import { useMedia } from "../ui/use-media";
import { CalendarLinkPanel } from "./calendar-link-panel";
import { CalendarIcon, PlusIcon } from "./icons";
import { ImportDialog, type ImportDone } from "./import-dialog";
import type { FormStart, Placed, Slot, TtSubject } from "./model";
import { SlotDetails } from "./slot-details";
import { SAVE_FAILED, SlotForm } from "./slot-form";
import { WeekGrid } from "./week-grid";

type Props = {
  slots: Slot[];
  subjects: TtSubject[];
  timezone: string;
  weekStart: "mon" | "sun";
  serverNow: number;
  /** ?week=YYYY-MM-DD */
  initialWeek: string | null;
  /** ?add=1[&subject=…&kind=…]: open the form straight away. */
  openAdd: { subjectId: string | null; kind: "class" | "study" | "other" } | null;
};

const isField = (el: EventTarget | null) =>
  el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));

/** The /timetable screen (docs/design/screens/timetable.md). */
export function TimetableScreen({ slots: initialSlots, subjects, timezone, weekStart, serverNow, initialWeek, openAdd }: Props) {
  const { play } = useSound();
  const timer = useTimer();
  const toast = useActionToast();
  const phone = useMedia("(max-width: 639px)");
  const laptop = useMedia("(min-width: 900px)");
  const reduced = useMedia("(prefers-reduced-motion: reduce)");

  const [slots, setSlots] = useState(initialSlots);
  const [now, setNow] = useState(serverNow);
  const today = todayIn(timezone, now);
  const thisWeek = weekStartOf(today, weekStart);
  const fromParam = initialWeek ? dayOf(initialWeek) : NaN;
  const [week, setWeek] = useState(Number.isFinite(fromParam) ? weekStartOf(fromParam, weekStart) : thisWeek);
  const [sel, setSel] = useState(() => {
    const target = Number.isFinite(fromParam) ? fromParam : today;
    const i = target - (Number.isFinite(fromParam) ? weekStartOf(fromParam, weekStart) : thisWeek);
    return i >= 0 && i < 7 ? i : 0;
  });
  const [anim, setAnim] = useState("");
  const [form, setForm] = useState<FormStart | null>(() => {
    if (!openAdd) return null;
    return { mode: "new", date: isoOf(today), startMin: 9 * 60, endMin: 10 * 60, kind: openAdd.kind, subjectId: openAdd.subjectId };
  });
  const [details, setDetails] = useState<{ item: Placed; el: HTMLElement } | null>(null);
  const [importing, setImporting] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [scopeAsk, setScopeAsk] = useState<{ item: Placed; day: number; startMin: number; endMin: number; el: HTMLElement | null } | null>(null);
  const [said, setSaid] = useState("");
  const [online, setOnline] = useState(true);
  const [newId, setNewId] = useState<string | null>(null);
  const addBtn = useRef<HTMLButtonElement>(null);

  const subjectMap = useMemo(() => new Map(subjects.map((s) => [s.id, s])), [subjects]);
  const nameOf = useCallback((id: string | null) => (id ? subjectMap.get(id)?.name ?? null : null), [subjectMap]);

  // The clock (the Now line moves each minute) and the connection.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    const on = () => setOnline(true), off = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { clearInterval(t); window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // Keep ?week= in the address so a reload (or the subject page's link) lands on the same week, and
  // on phones on the same day: it holds the chosen day, which a link's date already is.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (week === thisWeek && sel === today - thisWeek) url.searchParams.delete("week"); else url.searchParams.set("week", isoOf(week + sel));
    url.searchParams.delete("add"); url.searchParams.delete("subject"); url.searchParams.delete("kind");
    window.history.replaceState(window.history.state, "", url.pathname + url.search);
  }, [week, thisWeek, sel, today]);

  const announce = useCallback((text: string) => { setSaid(""); setTimeout(() => setSaid(text), 50); }, []);

  const items: Placed[][] = useMemo(() => weekItems(slots, week, timezone).map((list) =>
    list.map((it) => ({ slot: it.slot, occDate: it.occ.date, day: it.day, startMin: it.startMin, endMin: it.endMin, start: it.occ.start, end: it.occ.end }))), [slots, week, timezone]);
  const weekEmpty = items.every((d) => d.length === 0);
  const outside = useMemo(() => (weekEmpty && slots.length ? nearestOutside(slots, instantOf(timezone, week, 0), instantOf(timezone, week + 7, 0), timezone) : null), [weekEmpty, slots, week, timezone]);

  const goWeek = useCallback((target: number, daySel?: number) => {
    const dir = target > week ? "next" : "prev";
    if (target === week) { if (daySel !== undefined) setSel(daySel); return; }
    play("click");
    setAnim(reduced ? "" : `tt-anim-${dir}`);
    setWeek(target);
    setSel(daySel ?? (target === thisWeek ? today - thisWeek : 0));
  }, [week, play, reduced, thisWeek, today]);

  const goDay = useCallback((i: number) => {
    if (i < 0) return goWeek(week - 7, 6);
    if (i > 6) return goWeek(week + 7, 0);
    if (i === sel) return;
    play("click");
    setAnim(reduced ? "" : `tt-anim-day-${i > sel ? "next" : "prev"}`);
    setSel(i);
  }, [goWeek, week, sel, play, reduced]);

  const openNew = useCallback((day?: number, range?: { startMin: number; endMin: number }) => {
    if (!online) return;
    let d = day;
    let r = range;
    if (d === undefined) {
      d = phone ? week + sel : week === thisWeek ? today : week;
      const nowMin = localOf(timezone, now).min;
      const start = d === today ? Math.min(23 * 60, Math.ceil((nowMin + 1) / 60) * 60) : 9 * 60;
      r = { startMin: start, endMin: Math.min(1440, start + 60) };
    }
    setDetails(null);
    setForm({ mode: "new", date: isoOf(d), startMin: r!.startMin, endMin: r!.endMin });
  }, [online, phone, week, sel, thisWeek, today, timezone, now]);

  // Shortcuts: N new slot, T this week (not while typing or with a dialog open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isField(e.target)) return;
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "n" || e.key === "N") { e.preventDefault(); play("click"); openNew(); }
      else if (e.key === "t" || e.key === "T") { e.preventDefault(); goWeek(thisWeek, today - thisWeek); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openNew, goWeek, thisWeek, today, play]);

  const weekBarKey = (e: ReactKeyboardEvent) => {
    if (e.key === "ArrowLeft") { e.preventDefault(); goWeek(week - 7); }
    else if (e.key === "ArrowRight") { e.preventDefault(); goWeek(week + 7); }
  };

  // ---- saving ---------------------------------------------------------------------------
  const markNew = (before: Slot[], after: Slot[]) => {
    const old = new Set(before.map((s) => s.id));
    const made = after.find((s) => !old.has(s.id));
    if (made && !reduced) { setNewId(made.id); setTimeout(() => setNewId(null), 400); }
  };

  async function move(item: Placed, day: number, range: { startMin: number; endMin: number }, scope: EditScope) {
    const s = item.slot;
    const title = slotTitle(s, nameOf(s.subjectId));
    try {
      const res = await editSlot({
        id: s.id, date: item.occDate, scope: s.recurrence === "weekly" ? scope : "all",
        slot: { kind: s.kind, subjectId: s.subjectId, title: s.title ?? "", location: s.location ?? "", date: isoOf(day), ...range, repeats: s.recurrence, until: s.repeatUntil },
      });
      if (!res.ok) { play("boop"); toast.show(res.error); return; }
      play("pop");
      markNew(slots, res.slots);
      setSlots(res.slots);
      announce(movedLine(title, day, range.startMin, range.endMin));
    } catch {
      play("boop");
      toast.show(SAVE_FAILED);
    }
  }

  const onMove = (item: Placed, day: number, range: { startMin: number; endMin: number }, el: HTMLElement | null) => {
    if (item.slot.recurrence === "weekly") setScopeAsk({ item, day, ...range, el });
    else void move(item, day, range, "all");
  };

  const showUndoDelete = (title: string, undo: SlotUndo) => {
    toast.show(`Deleted ${title}.`, {
      label: "Undo",
      onClick: async () => {
        try {
          const r = await undoSlotDelete(undo);
          if (r.ok) { setSlots(r.slots); play("pop"); } else { play("boop"); toast.show(r.error); }
        } catch { play("boop"); toast.show("Couldn't undo that. Try again."); }
      },
    });
  };

  async function remove(item: Placed, scope: EditScope) {
    setDetails(null);
    const title = slotTitle(item.slot, nameOf(item.slot.subjectId));
    try {
      const res = await deleteSlot({ id: item.slot.id, date: item.occDate, scope });
      if (!res.ok) { play("boop"); toast.show(res.error); return; }
      play("tear");
      setSlots(res.slots);
      showUndoDelete(title, res.undo);
    } catch {
      play("boop");
      toast.show("Couldn't delete that slot. Try again.");
    }
  }

  function imported(d: ImportDone) {
    setImporting(false);
    setSlots(d.slots);
    const first = dayOf(d.firstDate);
    goWeek(weekStartOf(first, weekStart), first - weekStartOf(first, weekStart));
    toast.show(`Added ${d.count} ${d.count === 1 ? "class" : "classes"} to your timetable.`, {
      label: "Undo",
      onClick: async () => {
        try {
          const r = await undoImport({ batch: d.batch });
          if (r.ok) setSlots(r.slots); else { play("boop"); toast.show(r.error); }
        } catch { play("boop"); toast.show("Couldn't undo that. Try again."); }
      },
    });
  }

  // ---- layout ---------------------------------------------------------------------------
  const days = phone ? [week + sel] : Array.from({ length: 7 }, (_, i) => week + i);
  const shown = phone ? [items[sel]] : items;
  const nowLocal = localOf(timezone, now);
  const isThisWeek = week === thisWeek;
  const empty = slots.length === 0;
  const hourPx = laptop || phone ? 48 : 44;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <h1 className="font-display text-[20px] sm:text-[28px]">Timetable</h1>
        <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex sm:flex-wrap">
          <Button ref={addBtn} variant="primary" className="col-span-2" disabled={!online} onClick={() => openNew()} aria-keyshortcuts="N">
            <PlusIcon /> Add
          </Button>
          <Button disabled={!online} onClick={() => setImporting(true)}>Import timetable</Button>
          <Button onClick={() => setLinkOpen(true)}><CalendarIcon size={18} /> Add to my calendar</Button>
        </div>
      </div>

      {!online && <p className="offline-banner" role="status">You&apos;re offline. Changes will need a connection.</p>}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Week" onKeyDown={weekBarKey}>
          <Button size="sm" className="icon-btn" aria-label="Previous week" sound={null} onClick={() => goWeek(week - 7)}><span aria-hidden="true">‹</span></Button>
          <Button
            size="sm" sound={null} className="min-w-36 tabular-nums" aria-label={isThisWeek ? `Week of ${longDate(week).replace(/^\S+ /, "")}` : `This week. Showing week of ${longDate(week).replace(/^\S+ /, "")}`}
            aria-keyshortcuts="T" onClick={() => goWeek(thisWeek, today - thisWeek)} data-testid="week-label"
          >
            {isThisWeek ? weekLabel(week) : "This week"}
          </Button>
          <Button size="sm" className="icon-btn" aria-label="Next week" sound={null} onClick={() => goWeek(week + 7)}><span aria-hidden="true">›</span></Button>
          {!isThisWeek && <span className="font-bold tabular-nums" aria-hidden="true">{weekLabel(week)}</span>}
          {weekEmpty && !empty && (
            <p className="flex flex-wrap items-center gap-2" data-testid="nothing-this-week">
              <span>Nothing this week</span>
              {outside && (
                // goWeek plays the click (the slot is always in another week), so the Button stays silent: one sound per action.
                <Button size="sm" sound={null} onClick={() => { const ws = weekStartOf(outside.day, weekStart); goWeek(ws, outside.day - ws); }}>
                  {outside.kind === "class" ? "Next class" : "Next slot"}: {nextLabel(outside.day)}
                </Button>
              )}
            </p>
          )}
        </div>
        {phone && (
          <div role="radiogroup" aria-label="Day" className="day-strip">
            {Array.from({ length: 7 }, (_, i) => week + i).map((d, i) => (
              <label key={d} className={`day-chip${d === today ? " day-chip-today" : ""}`}>
                <input type="radio" className="sr-only" name="tt-day" checked={sel === i} onChange={() => goDay(i)} aria-label={longDate(d)} />
                <span aria-hidden="true">{weekdayShort(d)}</span>
                <span aria-hidden="true">{ymd(d).d}</span>
                {items[i].length > 0 && <span className="day-dot" aria-hidden="true" />}
              </label>
            ))}
          </div>
        )}
      </div>

      <WeekGrid
        key={phone ? "phone" : "wide"}
        days={days} items={shown} subjects={subjectMap} today={today} nowMin={days.includes(today) ? nowLocal.min : null}
        hourPx={hourPx} hourCol={phone ? 40 : 48} narrowEmptyWeekend={laptop} editable={online} anim={anim} newId={newId}
        onCreate={(day, range) => openNew(day, range)}
        onOpen={(item, el) => { play("click"); setDetails({ item, el }); }}
        onMove={onMove}
        onSwipe={phone ? (dir) => goDay(sel + dir) : undefined}
        overlay={empty ? (
          <div className="tt-empty">
            <div className="sticker flex max-w-sm flex-col items-center gap-3 p-5 text-center" data-testid="timetable-empty">
              <p className="font-display text-2xl">Your week is wide open</p>
              <p>{phone ? "Tap a time to add a class or study block, or bring in your uni timetable." : "Drag on the grid to add a class or study block, or bring in your uni timetable."}</p>
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" disabled={!online} onClick={() => setImporting(true)}>Import timetable</Button>
                <Button disabled={!online} onClick={() => openNew()}>Add a slot</Button>
              </div>
            </div>
          </div>
        ) : null}
      />

      <p className="sr-only" aria-live="polite" data-testid="tt-announce">{said}</p>

      <SlotDetails
        item={details?.item ?? null} anchor={details?.el ?? null} subjects={subjects} now={now}
        onClose={() => setDetails(null)}
        onEdit={(item) => { setDetails(null); setForm({ mode: "edit", slot: item.slot, occDate: item.occDate, date: isoOf(item.day), startMin: item.startMin, endMin: item.endMin }); }}
        onDelete={(item, scope) => void remove(item, scope)}
        onFocus={(item) => { setDetails(null); timer.startPhase("focus", { subjectId: item.slot.subjectId }); timer.openPanel(); }}
      />

      <SlotForm
        start={form} subjects={subjects}
        onClose={() => setForm(null)}
        onSaved={(next, info) => {
          markNew(slots, next);
          setSlots(next);
          setForm(null);
          const d = dayOf(info.date);
          const ws = weekStartOf(d, weekStart);
          if (ws !== week || (phone && d - ws !== sel)) goWeek(ws, d - ws);
        }}
        onDeleted={(next, undo, title) => { setSlots(next); setForm(null); showUndoDelete(title, undo); }}
      />

      <ImportDialog open={importing} onClose={() => setImporting(false)} subjects={subjects} weekStart={weekStart} onDone={imported} />
      <CalendarLinkPanel open={linkOpen} onClose={() => setLinkOpen(false)} timezone={timezone} />
      {scopeAsk && (
        <ScopeAsk
          anchor={scopeAsk.el}
          onPick={(scope) => { const a = scopeAsk; setScopeAsk(null); void move(a.item, a.day, { startMin: a.startMin, endMin: a.endMin }, scope); }}
          onCancel={() => setScopeAsk(null)}
        />
      )}
      {toast.node}
    </div>
  );
}

/** After dragging a weekly slot: "Just this week" or "Every week" (small popover). */
function ScopeAsk({ anchor, onPick, onCancel }: { anchor: HTMLElement | null; onPick: (s: EditScope) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const r = anchor?.getBoundingClientRect();
    const width = Math.min(300, window.innerWidth - 32);
    d.style.left = `${Math.min(Math.max(16, r?.left ?? 16), window.innerWidth - width - 16)}px`;
    d.style.top = `${Math.min(Math.max(16, (r?.bottom ?? 16) + 8), window.innerHeight - 180)}px`;
    d.show();
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onCancel(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [anchor, onCancel]);
  return (
    <dialog ref={ref} className="cite-popover" aria-labelledby="tt-scope-title" data-testid="scope-ask">
      <div className="flex flex-col gap-2 p-3">
        <p id="tt-scope-title" className="font-bold">Change which weeks?</p>
        <div className="flex flex-wrap gap-2">
          <Button ref={first} size="sm" variant="primary" sound={null} onClick={() => onPick("this")}>Just this week</Button>
          <Button size="sm" sound={null} onClick={() => onPick("all")}>Every week</Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </dialog>
  );
}
