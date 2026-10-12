"use client";
import { useEffect, useRef, type ReactNode } from "react";

/** Native <dialog>: focus trapping, Esc to close and inert background come for free. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" aria-label={title} onClose={onClose} onCancel={onClose}>
      <div className="flex flex-col gap-4 p-5 sm:p-6">
        <h2 className="font-display text-2xl">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}
