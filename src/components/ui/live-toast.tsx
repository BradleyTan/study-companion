"use client";
import { useEffect, useState } from "react";

/** Small "Saved" sticker that announces itself to screen readers and fades. */
export function useToast() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 2200);
    return () => clearTimeout(t);
  }, [msg]);
  const node = (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(16px+env(safe-area-inset-bottom,0px))] z-50 flex justify-center px-4">
      {msg && <span className="chip chip-ready pop-in px-4 py-1 text-base shadow-[3px_3px_0_var(--shadow)]">{msg}</span>}
    </div>
  );
  return { show: setMsg, node };
}
