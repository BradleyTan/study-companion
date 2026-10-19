"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useSound } from "../sound-provider";
import { Button } from "../ui/button";
import { useTimer } from "./timer-provider";
import { TimerView } from "./timer-view";

/**
 * The timer panel (timer.md "Where it lives"): a non-modal side panel (400 px) from 640 px so the
 * page stays usable beside it, a modal bottom sheet with a scrim on phones. Esc closes it and
 * focus goes back to the header chip.
 */
export function TimerPanel() {
  const t = useTimer();
  const { play } = useSound();
  const ref = useRef<HTMLDialogElement>(null);
  const title = useRef<HTMLHeadingElement>(null);
  const [sheet, setSheet] = useState(false);
  const [top, setTop] = useState(0);
  const open = t.panelOpen;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!open) {
      if (d.open) d.close();
      return;
    }
    const phone = window.matchMedia("(max-width: 639px)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSheet(phone);
    // The side panel sits under the sticky header, so the chip (and the rest of the header) stays usable.
    const header = document.querySelector("body header");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTop(phone ? 0 : Math.max(0, Math.round(header?.getBoundingClientRect().bottom ?? 0)));
    if (d.open) d.close();
    if (phone) d.showModal();
    else d.show();
    title.current?.focus();
  }, [open]);

  // The side panel isn't modal, so Esc closes it wherever focus is (unless something else used it).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector("dialog[open]:modal:not(#timer-panel)")) return;
      e.preventDefault();
      t.closePanel();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, t]);

  return (
    <dialog
      ref={ref}
      id="timer-panel"
      className={sheet ? "bottom-sheet timer-sheet" : "side-panel timer-side"}
      aria-labelledby="timer-panel-title"
      onCancel={(e) => { e.preventDefault(); t.closePanel(); }}
      style={sheet || !top ? undefined : { top, height: `calc(100dvh - ${top}px)`, maxHeight: `calc(100dvh - ${top}px)` }}
      onClick={(e) => { if (sheet && e.target === e.currentTarget) t.closePanel(); }}
      data-testid="timer-panel"
    >
      {open && (
        <div className="flex h-full flex-col">
          {sheet && <div className="sheet-handle" aria-hidden="true" />}
          <div className="flex items-center gap-2 border-b-2 border-ink px-4 py-3">
            <h2 id="timer-panel-title" ref={title} tabIndex={-1} className="min-w-0 flex-1 text-xl font-bold">Study timer</h2>
            <Link href="/timer" className="btn btn-ghost icon-btn min-h-11" aria-label="Full screen" title="Full screen" onClick={() => play("click")}>
              <svg aria-hidden="true" width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 8V3h5M17 8V3h-5M3 12v5h5M17 12v5h-5" /></svg>
            </Link>
            <Button variant="ghost" className="icon-btn min-h-11" aria-label="Close" title="Close" onClick={t.closePanel}>
              <span aria-hidden="true" className="text-xl leading-none">×</span>
            </Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-4">
            <TimerView variant="panel" />
          </div>
        </div>
      )}
    </dialog>
  );
}
