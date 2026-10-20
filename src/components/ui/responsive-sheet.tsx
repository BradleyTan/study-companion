"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { usePhone } from "./use-media";

/**
 * A modal that is a centred `Dialog` from 640 px and a `BottomSheet` on phones (timetable.md
 * forms and the import). Native <dialog>: focus trap, Esc and inert background come for free.
 */
export function ResponsiveSheet({ open, onClose, title, wide = false, children, testId }: {
  open: boolean; onClose: () => void; title: string; wide?: boolean; children: ReactNode; testId?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const phone = usePhone();
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open, phone]);
  return (
    <dialog
      key={phone ? "phone" : "wide"}
      ref={ref}
      className={phone ? "form-sheet" : `sheet${wide ? " sheet-wide" : ""}`}
      aria-labelledby={id}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (phone && e.target === e.currentTarget) onClose(); }}
      data-testid={testId}
    >
      {open && (
        <div className="flex flex-col gap-4 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] sm:p-6">
          {phone && <div className="sheet-handle -mt-3" aria-hidden="true" />}
          <h2 id={id} className="font-display text-2xl">{title}</h2>
          {children}
        </div>
      )}
    </dialog>
  );
}
