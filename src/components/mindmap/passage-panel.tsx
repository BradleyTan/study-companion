"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { getPassage } from "@/server/actions/mindmap";
import type { PassageView } from "@/server/passages";
import { ReadAloudButton, SpokenText } from "../read-aloud/read-aloud-button";
import { speech } from "../read-aloud/speech";
import { useSound } from "../sound-provider";
import { Button } from "../ui/button";

export type PanelNode = { id: string; label: string; chunkId: string | null };
type Load = { kind: "loading" } | { kind: "ready"; passage: PassageView } | { kind: "gone" } | { kind: "error"; text: string } | { kind: "group" };

const OWNER = "mindmap-passage";

/**
 * Passage behind a mindmap topic (mindmap.md "Tap / click / Enter on a node"): a side panel
 * from 640 px (the map stays usable beside it) or a bottom sheet on phones (focus trapped).
 */
export function PassagePanel({ node, onClose }: { node: PanelNode | null; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [sheet, setSheet] = useState(false);
  const drag = useRef<{ y: number; dy: number } | null>(null);
  const [dy, setDy] = useState(0);
  const { play } = useSound();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (!node) { if (d.open) d.close(); return; }
    const phone = window.matchMedia("(max-width: 639px)").matches;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSheet(phone);
    if (d.open) d.close();
    if (phone) d.showModal();
    else d.show();
    closeRef.current?.focus();
  }, [node]);

  useEffect(() => {
    if (!node) return;
    let alive = true;
    if (!node.chunkId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoad({ kind: "group" });
      return;
    }
    setLoad({ kind: "loading" });
    void getPassage(node.chunkId).then((res) => {
      if (!alive) return;
      if (!res.ok) setLoad({ kind: "error", text: res.error });
      else setLoad(res.passage ? { kind: "ready", passage: res.passage } : { kind: "gone" });
    }).catch(() => alive && setLoad({ kind: "error", text: "We couldn't load this passage. Try again." }));
    return () => { alive = false; };
  }, [node]);

  const close = () => { speech.stopIf(OWNER); onClose(); };

  return (
    <dialog
      ref={ref}
      className={sheet ? "bottom-sheet" : "side-panel"}
      aria-labelledby="passage-panel-title"
      onCancel={(e) => { e.preventDefault(); close(); }}
      onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); close(); } }}
      style={dy ? { transform: `translateY(${dy}px)` } : undefined}
      data-testid="passage-panel"
    >
      {node && (
        <div className="flex h-full flex-col">
          {sheet && (
            <div
              className="cursor-grab touch-none pb-1"
              aria-hidden="true"
              onPointerDown={(e) => { drag.current = { y: e.clientY, dy: 0 }; (e.target as HTMLElement).setPointerCapture(e.pointerId); }}
              onPointerMove={(e) => { if (drag.current) { drag.current.dy = Math.max(0, e.clientY - drag.current.y); setDy(drag.current.dy); } }}
              onPointerUp={() => { const moved = drag.current?.dy ?? 0; drag.current = null; setDy(0); if (moved > 80) close(); }}
            >
              <div className="sheet-handle" />
            </div>
          )}
          <div className="flex items-start gap-2 border-b-2 border-ink p-4">
            <h2 id="passage-panel-title" className="min-w-0 flex-1 break-words text-xl font-bold">{node.label}</h2>
            <Button ref={closeRef} size="sm" variant="ghost" className="min-h-11" onClick={close}>Close</Button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {load.kind === "loading" && <div aria-busy="true" className="flex flex-col gap-2"><div className="skeleton h-6 w-40" /><div className="skeleton h-28" /></div>}
            {load.kind === "group" && <p>This topic groups the ideas below it. Tap one of them to see where it came from.</p>}
            {load.kind === "gone" && <p>The note or file this came from was deleted.</p>}
            {load.kind === "error" && <p role="alert" className="error-text">{load.text}</p>}
            {load.kind === "ready" && (
              <>
                <p className="text-sm">
                  {load.passage.kind === "note"
                    ? <>From <strong>{load.passage.title}</strong> (note)</>
                    : <><strong>{load.passage.title}</strong>{load.passage.page ? `, page ${load.passage.page}` : ""}</>}
                </p>
                <blockquote className="whitespace-pre-wrap break-words rounded-md border-l-4 bg-card p-3 text-base" style={{ borderColor: "var(--subject)" }}>
                  <SpokenText owner={OWNER} part="passage" text={load.passage.text} />
                </blockquote>
                <div className="flex flex-wrap gap-2">
                  <Link href={load.passage.href} className="btn btn-sm min-h-11" onClick={() => play("click")}>
                    {load.passage.kind === "note" ? "Open in note" : "Open in file"}
                  </Link>
                  <ReadAloudButton owner={OWNER} parts={() => [{ part: "passage", text: load.passage.text }]} label={`the passage for ${node.label}`} className="min-h-11 w-auto px-3">
                    <span aria-hidden="true">🔊 </span>Read aloud
                  </ReadAloudButton>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
