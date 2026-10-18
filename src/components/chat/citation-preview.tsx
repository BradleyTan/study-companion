"use client";
import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { getPassage } from "@/server/actions/mindmap";
import type { CitationView } from "@/server/chat";
import type { PassageView } from "@/server/passages";
import { useSound } from "../sound-provider";
import { Button } from "../ui/button";

type Load = { kind: "loading" } | { kind: "ready"; passage: PassageView } | { kind: "gone" } | { kind: "error" };

/** The passage with the cited sentence marked (when the quote is found in it). */
function Marked({ text, quote }: { text: string; quote: string }) {
  const at = quote ? text.toLowerCase().indexOf(quote.toLowerCase()) : -1;
  if (at < 0) return <>{text}</>;
  return <>{text.slice(0, at)}<mark>{text.slice(at, at + quote.length)}</mark>{text.slice(at + quote.length)}</>;
}

/**
 * A citation's passage without leaving the chat (chat.md "Citation preview"): a popover anchored
 * to the chip from 640 px, a bottom sheet on phones. Esc or Close returns focus to the chip.
 */
export function CitationPreview({ citation, anchor, onClose }: { citation: CitationView | null; anchor: HTMLElement | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [sheet, setSheet] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const { play } = useSound();

  const close = () => {
    const d = ref.current;
    if (d?.open) d.close();
    onClose();
    anchor?.focus();
  };

  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!citation) { if (d.open) d.close(); return; }
    const phone = window.matchMedia("(max-width: 639px)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSheet(phone);
    if (d.open) d.close();
    if (phone) {
      setPos(null);
      d.showModal();
    } else {
      const r = anchor?.getBoundingClientRect();
      const width = Math.min(360, window.innerWidth - 32);
      const left = Math.min(Math.max(16, (r?.left ?? 16) - 24), window.innerWidth - width - 16);
      const below = (r?.bottom ?? 0) + 8;
      const roomBelow = window.innerHeight - below;
      setPos({ left, top: roomBelow > 260 ? below : Math.max(16, (r?.top ?? 0) - 8 - Math.min(480, window.innerHeight * 0.7)) });
      d.show();
    }
    closeRef.current?.focus();
  }, [citation, anchor]);

  // Non-modal popover: Esc and a click outside close it too.
  useEffect(() => {
    if (!citation || sheet) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); close(); } };
    const onDown = (e: MouseEvent) => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return;
      close();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => { document.removeEventListener("keydown", onKey); document.removeEventListener("mousedown", onDown); };
  });

  useEffect(() => {
    if (!citation) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoad({ kind: "loading" });
    void getPassage(citation.chunkId).then((res) => {
      if (!alive) return;
      if (!res.ok) setLoad({ kind: "error" });
      else setLoad(res.passage ? { kind: "ready", passage: res.passage } : { kind: "gone" });
    }).catch(() => alive && setLoad({ kind: "error" }));
    return () => { alive = false; };
  }, [citation]);

  return (
    <dialog
      ref={ref}
      className={sheet ? "bottom-sheet" : "cite-popover"}
      style={!sheet && pos ? { top: pos.top, left: pos.left } : undefined}
      aria-labelledby="cite-preview-title"
      onCancel={(e) => { e.preventDefault(); close(); }}
      data-testid="citation-preview"
    >
      {citation && (
        <div className="flex h-full flex-col">
          {sheet && <div className="sheet-handle" aria-hidden="true" />}
          <div className="flex items-start gap-2 border-b-2 border-ink p-3">
            <h2 id="cite-preview-title" className="min-w-0 flex-1 break-words text-base font-bold">
              <span className="cite-num mr-2" aria-hidden="true">{citation.n}</span>{citation.label}
            </h2>
            <Button ref={closeRef} size="sm" variant="ghost" className="min-h-11" onClick={close}>Close</Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            {citation.kind === "deleted" && <span className="chip w-fit">Source deleted</span>}
            {load.kind === "loading" && <div aria-busy="true" className="flex flex-col gap-2"><div className="skeleton h-5 w-40" /><div className="skeleton h-24" /></div>}
            {load.kind === "ready" && (
              <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-4 bg-card p-2 text-[15px]" style={{ borderColor: "var(--subject)" }}>
                <Marked text={load.passage.text} quote={citation.quote} />
              </blockquote>
            )}
            {(load.kind === "gone" || load.kind === "error") && (
              <>
                <p className="hint">{load.kind === "gone" ? "This passage has changed or was deleted. This is the part the answer used:" : "We couldn't load the passage. This is the part the answer used:"}</p>
                <blockquote className="quote-block whitespace-pre-wrap break-words">{citation.quote}</blockquote>
              </>
            )}
            {citation.href && (
              <Link href={citation.href} className="btn btn-sm min-h-11 w-fit" onClick={() => play("click")}>
                {citation.kind === "note" ? "Open in note" : "Open in file"}
              </Link>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
