"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useSound } from "../sound-provider";

export type MenuItem = { label: string; onSelect: () => void; danger?: boolean };

/**
 * "⋯" button (44 px) with a small list of actions. A disclosure, so Tab moves through it.
 * With `text`, the button shows that word instead of "⋯" (chat's "Not right?").
 * With `flip`, the list opens upwards when the button sits low on the screen (above a sticky composer).
 */
export function RowMenu({ label, items, className = "", text, align = "right", flip = false }: { label: string; items: MenuItem[]; className?: string; text?: string; align?: "left" | "right"; flip?: boolean }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { play } = useSound();
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);
  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        ref={btn} type="button" className={`btn btn-sm min-h-11 ${text ? "" : "icon-btn"}`} aria-label={label} aria-expanded={open} aria-controls={id}
        onClick={(e) => {
          play("click");
          if (flip) setUp(e.currentTarget.getBoundingClientRect().bottom > window.innerHeight * 0.55);
          setOpen(!open);
        }}
      >
        {text ?? <span aria-hidden="true">⋯</span>}
      </button>
      {open && (
        <ul id={id} className={`sticker absolute text-ink ${align === "left" ? "left-0" : "right-0"} ${up ? "bottom-full mb-2" : "top-full mt-2"} z-30 flex min-w-48 flex-col p-1`}>
          {items.map((it) => (
            <li key={it.label}>
              <button
                type="button" className={`flex min-h-11 w-full items-center rounded-md px-3 text-left font-bold hover:bg-highlight hover:text-[var(--on-colour)] ${it.danger ? "text-[var(--ink)]" : ""}`}
                onClick={() => { play("click"); setOpen(false); it.onSelect(); }}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
