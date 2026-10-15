"use client";
import { useEffect, useState } from "react";

/**
 * Thin progress bar (design-system.md `ProgressBar`). Decorative: the text next to it is the
 * accessible value, so the bar is hidden from screen readers. Animates from `from` to `value`
 * (both 0–1); no animation under reduced motion (globals.css).
 */
export function ProgressBar({ value, from = value }: { value: number; from?: number }) {
  const clamp = (n: number) => Math.min(1, Math.max(0, n));
  const [shown, setShown] = useState(clamp(from));
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(clamp(value)));
    return () => cancelAnimationFrame(id);
  }, [value]);
  return (
    <div className="progress-track" aria-hidden="true">
      <div className="progress-fill" style={{ width: `${shown * 100}%` }} />
    </div>
  );
}
