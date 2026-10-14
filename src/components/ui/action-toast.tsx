"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSound } from "../sound-provider";

type ToastAction = { label: string; onClick: () => void } | { label: string; href: string };
type Toast = { id: number; message: string; action?: ToastAction; ms: number };

/**
 * Toast with an optional action ("Undo", "See cards"). It's announced politely and the
 * action is a real, focusable control. Default life 6 s (flashcards.md "Delete").
 */
export function useActionToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const seq = useRef(0);
  const { play } = useSound();
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), toast.ms);
    return () => clearTimeout(t);
  }, [toast]);
  const show = useCallback((message: string, action?: ToastAction, ms = 6000) => setToast({ id: ++seq.current, message, action, ms }), []);
  const hide = useCallback(() => setToast(null), []);
  const node = (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(16px+env(safe-area-inset-bottom,0px))] z-50 flex justify-center px-4">
      {toast && (
        <div className="sticker pop-in pointer-events-auto flex items-center gap-3 px-4 py-2" data-testid="toast">
          <span className="font-bold">{toast.message}</span>
          {toast.action && ("href" in toast.action ? (
            <Link href={toast.action.href} className="btn btn-sm" onClick={() => { play("click"); setToast(null); }}>{toast.action.label}</Link>
          ) : (
            <button type="button" className="btn btn-sm" onClick={() => { play("click"); const a = toast.action as { onClick: () => void }; setToast(null); a.onClick(); }}>
              {toast.action.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
  return { show, hide, node };
}
