"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { shortDate } from "@/lib/timetable/dates";
import { KIND_LABEL, repeatLabel, slotTitle, timeRange, type EditScope } from "@/lib/timetable/slots";
import { subjectStyle } from "../ui/subject-style";
import { usePhone } from "../ui/use-media";
import { Button } from "../ui/button";
import type { Placed, TtSubject } from "./model";

/**
 * Slot details (timetable.md "Slot details"): a popover anchored to the slot from 640 px, a
 * bottom sheet on phones. Esc closes it and focus goes back to the slot.
 */
export function SlotDetails({ item, anchor, subjects, now, onClose, onEdit, onDelete, onFocus }: {
  item: Placed | null;
  anchor: HTMLElement | null;
  subjects: TtSubject[];
  now: number;
  onClose: () => void;
  onEdit: (item: Placed) => void;
  onDelete: (item: Placed, scope: EditScope) => void;
  onFocus: (item: Placed) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const firstBtn = useRef<HTMLButtonElement>(null);
  const phone = usePhone();
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [confirm, setConfirm] = useState(false);

  const close = () => {
    if (ref.current?.open) ref.current.close();
    onClose();
    anchor?.focus();
  };

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    setConfirm(false);
    if (!item) { if (d.open) d.close(); return; }
    if (d.open) d.close();
    if (phone) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPos(null);
      d.showModal();
    } else {
      const r = anchor?.getBoundingClientRect();
      const width = Math.min(340, window.innerWidth - 32);
      const right = (r?.right ?? 16) + 8;
      const left = right + width < window.innerWidth - 16 ? right : Math.max(16, (r?.left ?? 16) - width - 8);
      const top = Math.min(Math.max(16, r?.top ?? 16), window.innerHeight - 340);
      setPos({ left, top: Math.max(16, top) });
      d.show();
    }
    firstBtn.current?.focus();
  }, [item, anchor, phone]);

  // The popover isn't modal: Esc and a click outside close it.
  useEffect(() => {
    if (!item || phone) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || document.querySelector("dialog[open]:modal")) return;
      e.preventDefault();
      close();
    };
    const onDown = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      if (ref.current?.open) ref.current.close();
      onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("pointerdown", onDown); };
  });

  useEffect(() => { if (confirm) firstBtn.current?.focus(); }, [confirm]);

  const subject = item ? subjects.find((s) => s.id === item.slot.subjectId) ?? null : null;
  const title = item ? slotTitle(item.slot, subject?.name ?? null) : "";
  const canFocus = !!item && item.slot.kind === "study" && now >= item.start - 15 * 60_000 && now < item.end;
  const weekly = item?.slot.recurrence === "weekly";

  return (
    <dialog
      ref={ref}
      className={phone ? "form-sheet" : "cite-popover"}
      aria-labelledby="slot-details-title"
      style={pos ? { top: pos.top, left: pos.left } : undefined}
      onCancel={(e) => { e.preventDefault(); close(); }}
      onClick={(e) => { if (phone && e.target === e.currentTarget) close(); }}
      data-testid="slot-details"
    >
      {item && (
        <div className="flex flex-col gap-3 p-4 pb-[calc(1rem+env(safe-area-inset-bottom,0px))]" style={subject ? subjectStyle(subject.colour) : undefined}>
          {phone && <div className="sheet-handle -mt-2" aria-hidden="true" />}
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">{KIND_LABEL[item.slot.kind]}</span>
            {subject ? (
              <span className="chip" style={{ background: "var(--subject)", color: "var(--on-colour)" }}>{subject.emoji} {subject.name}</span>
            ) : <span className="chip">No subject</span>}
          </div>
          <h2 id="slot-details-title" className="text-xl font-bold">{title}</h2>
          <ul className="flex flex-col gap-1">
            <li className="tabular-nums">{shortDate(item.day)}, {timeRange(item.startMin, item.endMin)}</li>
            <li>{repeatLabel(item.slot)}</li>
            {item.slot.location && <li>{item.slot.location}</li>}
            {item.slot.source === "import" && <li className="hint">Imported from your uni timetable</li>}
          </ul>
          {confirm ? (
            <div role="group" aria-label="Confirm delete" className="flex flex-col gap-2">
              <p className="font-bold">Delete {title}?</p>
              <div className="flex flex-wrap gap-2">
                <Button ref={firstBtn} variant="danger" sound={null} onClick={() => onDelete(item, "this")}>Just this week</Button>
                <Button variant="danger" sound={null} onClick={() => onDelete(item, "all")}>Every week</Button>
                <Button onClick={() => setConfirm(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {canFocus && <Button ref={firstBtn} variant="primary" onClick={() => onFocus(item)}><span aria-hidden="true">🍅</span> Start focus</Button>}
              <Button ref={canFocus ? undefined : firstBtn} onClick={() => onEdit(item)}>Edit</Button>
              <Button variant="danger" sound={weekly ? "click" : null} onClick={() => (weekly ? setConfirm(true) : onDelete(item, "all"))}>Delete</Button>
              <Button variant="ghost" className="ml-auto" onClick={close}>Close</Button>
            </div>
          )}
        </div>
      )}
    </dialog>
  );
}
