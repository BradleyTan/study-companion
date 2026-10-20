"use client";
import { useId } from "react";
import { Button } from "../ui/button";

/**
 * "− 25 min +" (timer.md, settings.md): 44 px buttons labelled "Shorter focus" / "Longer focus",
 * the value in a read-only <output>. With `label`, a visible label sits above it (settings).
 */
export function DurationStepper({ value, min, max, step, unit, what, label, onChange, ghost = false, wide = false }: {
  value: number;
  min: number;
  max: number;
  step: number;
  unit: "min" | "rounds";
  /** Lower-case name for the buttons ("focus" → "Shorter focus"). */
  what: string;
  label?: string;
  onChange: (v: number) => void;
  ghost?: boolean;
  wide?: boolean;
}) {
  const id = useId();
  const less = unit === "rounds" ? `Fewer rounds before a long break` : `Shorter ${what}`;
  const more = unit === "rounds" ? `More rounds before a long break` : `Longer ${what}`;
  const spoken = unit === "rounds" ? `${value} rounds` : `${value} ${value === 1 ? "minute" : "minutes"}`;
  return (
    <div className={`flex flex-col gap-1 ${wide ? "w-full sm:w-auto" : ""}`}>
      {label && <span id={`${id}-l`} className="label">{label}</span>}
      <div className={`flex items-center gap-1 ${wide ? "justify-between sm:justify-start" : ""}`} role="group" aria-labelledby={label ? `${id}-l` : undefined} aria-label={label ? undefined : `${what} length`}>
        <Button variant={ghost ? "ghost" : "plain"} className="icon-btn" aria-label={less} disabled={value <= min} onClick={() => onChange(Math.max(min, value - step))}>
          <span aria-hidden="true">−</span>
        </Button>
        <output className="min-w-[5.5rem] text-center font-bold tabular-nums" aria-live="off" aria-label={spoken}>
          {value} {unit}
        </output>
        <Button variant={ghost ? "ghost" : "plain"} className="icon-btn" aria-label={more} disabled={value >= max} onClick={() => onChange(Math.min(max, value + step))}>
          <span aria-hidden="true">+</span>
        </Button>
      </div>
    </div>
  );
}
