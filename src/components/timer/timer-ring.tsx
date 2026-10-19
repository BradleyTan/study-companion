"use client";
import type { ReactNode } from "react";
import type { Phase } from "@/lib/timer/machine";

/**
 * The kitchen-timer ring (timer.md "Ring"): a 16 px band between two ink outlines on a `--card`
 * track. Focus drains clockwise from 12 o'clock in `--subject` (or `--highlight` with no subject);
 * a break fills with `--success`. A 4 px ink notch marks the moving edge. Decorative only
 * (aria-hidden): the numbers in the centre carry the meaning.
 */
export function TimerRing({ size, phase, elapsed, colour, bump, children }: {
  size: number;
  phase: Phase;
  /** Share of the phase gone, 0..1. */
  elapsed: number;
  /** Focus band colour (CSS value). */
  colour: string;
  /** Changes when a phase ends: the ring does one small spring. */
  bump?: string | null;
  children: ReactNode;
}) {
  const band = 16;
  const r = size / 2 - band / 2 - 4;
  const c = 2 * Math.PI * r;
  const focus = phase === "focus";
  const shown = focus ? 1 - elapsed : elapsed;
  // Focus: the filled part runs from the moving edge round to 12 o'clock. Break: from 12 to the edge.
  const dash = `${(shown * c).toFixed(2)} ${c.toFixed(2)}`;
  const offset = focus ? -(elapsed * c) : 0;
  const mid = size / 2;
  return (
    <div className="timer-ring relative mx-auto" style={{ width: size, maxWidth: "100%", aspectRatio: "1 / 1" }}>
      <svg key={bump ?? "ring"} viewBox={`0 0 ${size} ${size}`} className={`h-full w-full ${bump ? "ring-bump" : ""}`} aria-hidden="true" focusable="false">
        <g transform={`rotate(-90 ${mid} ${mid})`}>
          <circle cx={mid} cy={mid} r={r} fill="none" stroke="var(--card)" strokeWidth={band} />
          <circle
            cx={mid} cy={mid} r={r} fill="none" stroke={focus ? colour : "var(--success)"} strokeWidth={band}
            strokeDasharray={dash} strokeDashoffset={offset} className="ring-move" data-testid="ring-band"
          />
          <circle cx={mid} cy={mid} r={r + band / 2} fill="none" stroke="var(--ink)" strokeWidth={2.5} />
          <circle cx={mid} cy={mid} r={r - band / 2} fill="none" stroke="var(--ink)" strokeWidth={2.5} />
        </g>
        <g className="ring-move" style={{ transform: `rotate(${elapsed * 360}deg)`, transformOrigin: `${mid}px ${mid}px` }}>
          <line x1={mid} y1={mid - r - band / 2} x2={mid} y2={mid - r + band / 2} stroke="var(--ink)" strokeWidth={4} strokeLinecap="round" />
        </g>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 px-8 text-center">{children}</div>
    </div>
  );
}
