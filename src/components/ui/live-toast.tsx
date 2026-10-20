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
      {/* Same sticker look as the action toast ("Card deleted · Undo"), polish.md P3-1. */}
      {msg && <span className="sticker pop-in px-4 py-2 font-bold">{msg === "Saved" && <span aria-hidden="true">✓ </span>}{msg}</span>}
    </div>
  );
  return { show: setMsg, node };
}
