"use client";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { hhmm, weekdayOf, weekdayShort, ymd } from "@/lib/timetable/dates";
import { clickRange, dayLabel, dragRange, minuteAt, moveRange, resizeEnd, scrollMinute, slotName, tapRange } from "@/lib/timetable/grid";
import { overlapColumns, slotTitle, timeRange } from "@/lib/timetable/slots";
import { subjectStyle } from "../ui/subject-style";
import { ChalkboardIcon, PencilIcon, RepeatIcon } from "./icons";
import type { Placed, TtSubject } from "./model";

type Range = { startMin: number; endMin: number };
type Ghost = { dayIndex: number } & Range;
type Moving = { item: Placed; mode: "move" | "resize"; dayIndex: number } & Range;

/**
 * The week on graph paper (timetable.md "Grid"). Each day is a <section> with a time-ordered list
 * of slot buttons; the empty space is a pointer-only drag layer (aria-hidden). Mouse and pen drag
 * to create, move and resize; touch taps to create, so scrolling never makes a slot.
 */
export function WeekGrid({
  days, items, subjects, today, nowMin, hourPx, hourCol, narrowEmptyWeekend, editable, anim, overlay, newId,
  onCreate, onOpen, onMove, onSwipe,
}: {
  days: number[];
  items: Placed[][];
  subjects: Map<string, TtSubject>;
  today: number;
  /** Minutes into today (the Now line), or null. */
  nowMin: number | null;
  hourPx: number;
  hourCol: number;
  narrowEmptyWeekend: boolean;
  editable: boolean;
  anim: string;
  overlay?: ReactNode;
  /** A slot that was just saved (pops in). */
  newId: string | null;
  onCreate: (day: number, range: Range) => void;
  onOpen: (item: Placed, el: HTMLElement) => void;
  onMove: (item: Placed, day: number, range: Range, el: HTMLElement | null) => void;
  onSwipe?: (dir: 1 | -1) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const bodies = useRef<(HTMLDivElement | null)[]>([]);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const [tap, setTap] = useState<Ghost | null>(null);
  const drag = useRef<{ kind: "create"; dayIndex: number; anchor: number; x: number; y: number; moved: boolean } | null>(null);
  const slotDrag = useRef<{ item: Placed; mode: "move" | "resize"; x: number; y: number; started: boolean; el: HTMLElement } | null>(null);
  const touch = useRef<{ x: number; y: number; t: number; dayIndex: number; offY: number } | null>(null);
  const suppressClick = useRef(false);

  // Scroll to 30 minutes before the earliest slot of the week (or 8:00) when the week changes.
  const firstMins = items.flat().map((i) => i.startMin);
  const scrollKey = `${days[0]}:${days.length}`;
  const target = scrollMinute(firstMins);
  const scrolled = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (scrolled.current === scrollKey || !scroller.current) return;
    scrolled.current = scrollKey;
    scroller.current.scrollTop = (target / 60) * hourPx;
  }, [scrollKey, target, hourPx]);

  // Esc cancels a drag.
  useEffect(() => {
    if (!ghost && !moving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      // A cancelled move still ends with a click on the slot: don't open its details for it.
      if (slotDrag.current) suppressClick.current = true;
      drag.current = null;
      slotDrag.current = null;
      setGhost(null);
      setMoving(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [ghost, moving]);

  const minAt = (dayIndex: number, clientY: number) => {
    const r = bodies.current[dayIndex]?.getBoundingClientRect();
    return minuteAt(clientY - (r?.top ?? 0), hourPx);
  };
  const dayAt = (clientX: number, fallback: number) => {
    const i = bodies.current.findIndex((b) => { const r = b?.getBoundingClientRect(); return !!r && clientX >= r.left && clientX < r.right; });
    return i === -1 ? fallback : i;
  };

  // ---- create (drag layer) ---------------------------------------------------------------
  const layerDown = (dayIndex: number) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (!editable || e.button !== 0) return;
    if (e.pointerType === "touch") {
      const r = e.currentTarget.getBoundingClientRect();
      touch.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, dayIndex, offY: e.clientY - r.top };
      return;
    }
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const anchor = minAt(dayIndex, e.clientY);
    drag.current = { kind: "create", dayIndex, anchor, x: e.clientX, y: e.clientY, moved: false };
    setGhost({ dayIndex, ...dragRange(anchor, anchor) });
  };
  const layerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (Math.abs(e.clientY - d.y) > 4) d.moved = true;
    setGhost({ dayIndex: d.dayIndex, ...dragRange(d.anchor, minAt(d.dayIndex, e.clientY)) });
  };
  const layerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") {
      const t = touch.current;
      touch.current = null;
      if (!t || !editable) return;
      const dx = e.clientX - t.x, dy = e.clientY - t.y;
      if (onSwipe && Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) { onSwipe(dx < 0 ? 1 : -1); return; }
      if (Math.abs(dx) > 10 || Math.abs(dy) > 10 || e.timeStamp - t.t > 600) return;
      const range = tapRange(t.offY, hourPx);
      setTap({ dayIndex: t.dayIndex, ...range });
      // A short highlight first, so the student sees where it went.
      setTimeout(() => { setTap(null); onCreate(days[t.dayIndex], range); }, 120);
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    const range = d.moved ? dragRange(d.anchor, minAt(d.dayIndex, e.clientY)) : clickRange(d.anchor);
    setGhost(null);
    onCreate(days[d.dayIndex], range);
  };
  const layerCancel = () => { drag.current = null; touch.current = null; setGhost(null); };

  // ---- move and resize (slot buttons) -------------------------------------------------------
  const slotDown = (item: Placed, mode: "move" | "resize") => (e: React.PointerEvent<HTMLElement>) => {
    if (!editable || e.button !== 0 || e.pointerType === "touch") return;
    e.stopPropagation();
    const el = (e.currentTarget.closest(".tt-slot") as HTMLElement | null) ?? e.currentTarget;
    slotDrag.current = { item, mode, x: e.clientX, y: e.clientY, started: false, el };
    el.setPointerCapture(e.pointerId);
  };
  const slotMove = (e: React.PointerEvent<HTMLElement>) => {
    const s = slotDrag.current;
    if (!s) return;
    const dx = e.clientX - s.x, dy = e.clientY - s.y;
    if (!s.started && Math.hypot(dx, dy) < 5) return;
    s.started = true;
    const delta = (dy / hourPx) * 60;
    const from = days.indexOf(s.item.day);
    if (s.mode === "resize") {
      setMoving({ item: s.item, mode: "resize", dayIndex: from, startMin: s.item.startMin, endMin: resizeEnd(s.item.startMin, s.item.endMin, delta) });
    } else {
      setMoving({ item: s.item, mode: "move", dayIndex: dayAt(e.clientX, from), ...moveRange(s.item.startMin, s.item.endMin, delta) });
    }
  };
  const slotUp = () => {
    const s = slotDrag.current;
    slotDrag.current = null;
    if (!s?.started) return;
    suppressClick.current = true;
    setTimeout(() => { suppressClick.current = false; }, 0);
    const m = moving;
    setMoving(null);
    if (!m) return;
    const day = days[m.dayIndex];
    if (day === s.item.day && m.startMin === s.item.startMin && m.endMin === s.item.endMin) return;
    onMove(s.item, day, { startMin: m.startMin, endMin: m.endMin }, s.el);
  };

  const anyInDay = items.map((list) => list.length > 0);
  const cols = days.map((d, i) => (narrowEmptyWeekend && (weekdayOf(d) === 0 || weekdayOf(d) === 6) && !anyInDay[i] ? "minmax(0,0.8fr)" : "minmax(0,1fr)")).join(" ");
  const style = { ["--hour" as string]: `${hourPx}px`, ["--hourcol" as string]: `${hourCol}px`, ["--cols" as string]: cols } as CSSProperties;

  return (
    <div className="tt-frame" data-testid="week-grid">
      {/* With no slots to tab to, the scroller itself takes focus so the keyboard can scroll it. */}
      <div
        ref={scroller} className="tt-scroll" style={style}
        {...(items.some((l) => l.length) ? {} : { tabIndex: 0, role: "region", "aria-label": "Week grid" })}
      >
        <div className={`tt-grid ${anim}`} style={{ gridTemplateColumns: `var(--hourcol) ${cols}` }}>
          <div aria-hidden="true">
            <div className="tt-corner" />
            <div className="tt-hours">
              {Array.from({ length: 23 }, (_, h) => h + 1).map((h) => (
                <span key={h} className="tt-hour-label" style={{ top: h * hourPx }}>{h}:00</span>
              ))}
            </div>
          </div>
          {days.map((day, i) => {
            const list = items[i] ?? [];
            const layout = overlapColumns(list);
            const isToday = day === today;
            return (
              <section key={day} className="tt-day" aria-label={dayLabel(day, today)} data-day={day}>
                <div className={`tt-dayhead${isToday ? " tt-dayhead-today" : ""}`} aria-hidden="true">
                  <span>{weekdayShort(day)} {ymd(day).d}</span>
                </div>
                <div ref={(el) => { bodies.current[i] = el; }} className="tt-day-body">
                  <div
                    className="tt-layer" aria-hidden="true" data-testid={`drag-layer-${i}`}
                    onPointerDown={layerDown(i)} onPointerMove={layerMove} onPointerUp={layerUp} onPointerCancel={layerCancel}
                  />
                  {tap?.dayIndex === i && <div className="tt-tap" style={{ top: (tap.startMin / 60) * hourPx, height: hourPx }} />}
                  {ghost?.dayIndex === i && (
                    <div className="tt-ghost" style={{ top: (ghost.startMin / 60) * hourPx, height: ((ghost.endMin - ghost.startMin) / 60) * hourPx }} data-testid="drag-ghost">
                      {timeRange(ghost.startMin, ghost.endMin)}
                    </div>
                  )}
                  {moving?.dayIndex === i && (
                    <div className="tt-ghost" style={{ top: (moving.startMin / 60) * hourPx, height: ((moving.endMin - moving.startMin) / 60) * hourPx }} data-testid="drag-ghost">
                      {timeRange(moving.startMin, moving.endMin)}
                    </div>
                  )}
                  {isToday && nowMin !== null && (
                    <div className="tt-now" style={{ top: (nowMin / 60) * hourPx }} data-testid="now-line">
                      <span className="tt-now-pill">Now</span>
                    </div>
                  )}
                  <ul className="tt-list">
                    {list.map((it, k) => (
                      <li key={`${it.slot.id}:${it.occDate}`}>
                        <SlotSticker
                          item={it} subject={it.slot.subjectId ? subjects.get(it.slot.subjectId) ?? null : null} hourPx={hourPx}
                          col={layout[k].col} cols={layout[k].cols} editable={editable}
                          isMoving={moving?.item.slot.id === it.slot.id && moving.item.occDate === it.occDate} isNew={newId === it.slot.id}
                          onClick={(el) => { if (suppressClick.current) { suppressClick.current = false; return; } onOpen(it, el); }}
                          onDown={slotDown} onMove={slotMove} onUp={slotUp}
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {overlay}
    </div>
  );
}

function SlotSticker({ item, subject, hourPx, col, cols, editable, isMoving, isNew, onClick, onDown, onMove, onUp }: {
  item: Placed; subject: TtSubject | null; hourPx: number; col: number; cols: number; editable: boolean; isMoving: boolean; isNew: boolean;
  onClick: (el: HTMLElement) => void;
  onDown: (item: Placed, mode: "move" | "resize") => (e: React.PointerEvent<HTMLElement>) => void;
  onMove: (e: React.PointerEvent<HTMLElement>) => void;
  onUp: () => void;
}) {
  const { slot } = item;
  const height = ((item.endMin - item.startMin) / 60) * hourPx;
  const title = slotTitle(slot, subject?.name ?? null);
  const weekly = slot.recurrence === "weekly";
  const emoji = subject?.emoji;
  const cls = [
    "tt-slot", `tt-slot-${slot.kind}`, !subject && "tt-slot-nosubject", height < 44 && cols === 1 && "tt-slot-short",
    isMoving && "tt-slot-moving", isNew && "pop-in",
  ].filter(Boolean).join(" ");
  const icon = slot.kind === "class" ? <ChalkboardIcon /> : slot.kind === "study" ? <PencilIcon /> : null;
  const style: CSSProperties = {
    ...(subject ? subjectStyle(subject.colour) : {}),
    top: (item.startMin / 60) * hourPx,
    height: Math.max(height, 6),
    left: `calc(${(col / cols) * 100}% + 3px)`,
    width: `calc(${100 / cols}% - 6px)`,
  };
  return (
    <button
      type="button" className={cls} style={style}
      aria-label={slotName({ kind: slot.kind, title: slot.title, subjectName: subject?.name ?? null, startMin: item.startMin, endMin: item.endMin, location: slot.location, weekly })}
      data-testid="slot" data-slot-id={slot.id} data-date={item.occDate}
      onClick={(e) => onClick(e.currentTarget)}
      onPointerDown={onDown(item, "move")} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
    >
      <span className="tt-line font-bold" aria-hidden="true">
        {icon}
        {emoji && <span>{emoji}</span>}
        <span className="tt-text">{title}</span>
        {height >= 32 && height < 64 && <span className="font-normal tabular-nums">{hhmm(item.startMin)}</span>}
        {weekly && <span className="ml-auto shrink-0"><RepeatIcon /></span>}
      </span>
      {height >= 64 && <span className="tt-line tabular-nums" aria-hidden="true"><span className="tt-text">{timeRange(item.startMin, item.endMin)}</span></span>}
      {height >= 64 && slot.location && <span className="tt-line" aria-hidden="true"><span className="tt-text">{slot.location}</span></span>}
      {height >= 64 && !subject && <span className="tt-line" aria-hidden="true"><span className="tt-chip">No subject</span></span>}
      {editable && (
        <span
          className="tt-resize" aria-hidden="true" data-testid="slot-resize"
          onPointerDown={(e) => { e.stopPropagation(); onDown(item, "resize")(e); }}
        />
      )}
    </button>
  );
}
