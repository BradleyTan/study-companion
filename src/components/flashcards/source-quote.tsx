"use client";
import Link from "next/link";
import { useId, useState } from "react";
import type { CardSourceInfo } from "@/server/cards";
import { useSound } from "../sound-provider";

/** Quote block + passage link shared by the deck, review and the make dialog (flashcards.md). */
export function SourceQuote({ quote, source, newTab = false, compact = false }: { quote: string | null; source: CardSourceInfo; newTab?: boolean; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const { play } = useSound();
  if (source.kind === "manual") return <span className="chip w-fit">Written by you</span>;
  const long = (quote?.length ?? 0) > 180;
  return (
    <div className="flex flex-col gap-1.5">
      {quote && (
        <blockquote id={id} className={`quote-block ${open || compact ? "" : "clamp-3"}`}>
          {compact ? quote.split(/(?<=[.!?])\s/)[0] : quote}
        </blockquote>
      )}
      {quote && long && !compact && (
        <button type="button" className="inline-flex min-h-11 w-fit items-center text-sm font-bold underline underline-offset-2" aria-expanded={open} aria-controls={id} onClick={() => { play("click"); setOpen(!open); }}>
          {open ? "Show less" : "Show more"}
        </button>
      )}
      {!compact && (
        source.kind === "deleted" ? (
          <span className="chip w-fit">Source deleted</span>
        ) : (
          <span className="text-sm">
            From{" "}
            <Link href={source.href} className="inline-flex min-h-11 items-center font-bold underline underline-offset-2" {...(newTab ? { target: "_blank", rel: "noopener" } : {})} onClick={() => play("click")}>
              {source.title}
            </Link>
            {source.kind === "note" ? " (note)" : source.page ? `, page ${source.page}` : ""}
            {newTab && <span className="sr-only"> (opens in a new tab)</span>}
          </span>
        )
      )}
    </div>
  );
}
