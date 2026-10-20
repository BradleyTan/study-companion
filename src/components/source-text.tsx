"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { openFileUrl } from "@/lib/open-file";
import { getDownloadUrl } from "@/server/actions/sources";
import { useSound } from "./sound-provider";
import { Button } from "./ui/button";

export type SourcePage = { page: number; blocks: { before: string; mark: string | null; after: string }[] };

/** The extracted text of a lecture file; scrolls to and marks the cited passage. */
export function SourceText({ sourceId, fileName, kind, pageCount, pages, missing, quote, markedPage, canOpen }: {
  sourceId: string;
  fileName: string;
  kind: "pdf" | "pptx";
  /** Pages (PDF) or slides (PPTX) in the file, for the "Lecture file · 3 pages" line; null while unknown. */
  pageCount: number | null;
  pages: SourcePage[];
  missing: boolean;
  quote: string | null;
  markedPage: number | null;
  canOpen: boolean;
}) {
  const { play } = useSound();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const markRef = useRef<HTMLElement>(null);
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    const el = markRef.current;
    if (!el) return;
    el.scrollIntoView({ block: "center" });
    // Reduced motion: the mark stays until the first keypress (no fade animation).
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!reduce) return;
    const onKey = () => setFaded(true);
    window.addEventListener("keydown", onKey, { once: true });
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const open = () => start(async () => {
    setError(null);
    const res = await getDownloadUrl(sourceId);
    if (!res.ok) { setError(res.error); play("boop"); return; }
    // PDFs open at the cited page where the browser's viewer supports it.
    const url = kind === "pdf" && markedPage ? `${res.url}#page=${markedPage}` : res.url;
    openFileUrl(url);
  });

  return (
    <article className="flex flex-col gap-4" aria-labelledby="source-title">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <h1 id="source-title" className="font-display text-3xl [overflow-wrap:anywhere] sm:text-4xl">{fileName}</h1>
          <p className="hint">Lecture file{pageCount ? ` · ${pageCount} ${kind === "pdf" ? "page" : "slide"}${pageCount === 1 ? "" : "s"}` : ""}</p>
        </div>
        <Button size="sm" disabled={!canOpen || pending} onClick={open}>Open the original file</Button>
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
      {missing && (
        <div role="status" className="sticker-flat flex flex-col gap-2 bg-highlight p-3 text-[var(--on-colour)]">
          <p className="font-bold">This passage has changed since the card was made.</p>
          {quote && <blockquote className="border-l-4 border-ink pl-3 italic">{quote}</blockquote>}
        </div>
      )}
      {pages.length === 0 ? (
        <p className="sticker-flat p-4 text-ink-soft">We couldn&apos;t find any text in this file.</p>
      ) : (
        pages.map((p) => (
          <section key={p.page} aria-labelledby={`page-${p.page}`} className="sticker-flat flex flex-col gap-3 p-4">
            <h2 id={`page-${p.page}`} className="text-lg font-bold">Page {p.page}</h2>
            {p.blocks.map((b, i) => (
              <p key={i} className="whitespace-pre-wrap break-words">
                {b.before}
                {b.mark !== null && (
                  <mark ref={markRef} data-testid="passage-mark" className={faded ? "" : "mark mark-fade"} style={faded ? { background: "transparent", color: "inherit" } : undefined}>{b.mark}</mark>
                )}
                {b.after}
              </p>
            ))}
          </section>
        ))
      )}
    </article>
  );
}
