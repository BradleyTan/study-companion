"use client";
import { motion } from "framer-motion";

/** 40 paper pieces from the top centre, 1.2 s (review.md "End of session"). Built in-house. */
export function Confetti({ colours }: { colours: string[] }) {
  const pieces = Array.from({ length: 40 }, (_, i) => {
    // Deterministic spread so renders are stable.
    const a = Math.sin(i * 12.9898) * 43758.5453;
    const r = a - Math.floor(a);
    const b = Math.sin(i * 78.233) * 12345.678;
    const r2 = b - Math.floor(b);
    return {
      x: (r - 0.5) * 900,
      y: 300 + r2 * 400,
      rotate: (r2 - 0.5) * 720,
      strip: i % 3 === 0,
      colour: colours[i % colours.length],
      delay: r * 0.15,
    };
  });
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-40 flex justify-center overflow-hidden" style={{ height: "100dvh" }}>
      {pieces.map((p, i) => (
        <motion.span
          key={i}
          className="absolute top-0 border border-[var(--ink)]"
          style={{ background: p.colour, width: p.strip ? 6 : 10, height: p.strip ? 16 : 10 }}
          initial={{ x: 0, y: -20, rotate: 0, opacity: 1 }}
          animate={{ x: p.x, y: p.y, rotate: p.rotate, opacity: 0 }}
          transition={{ duration: 1.2, delay: p.delay, ease: [0.2, 0.7, 0.4, 1] }}
        />
      ))}
    </div>
  );
}
