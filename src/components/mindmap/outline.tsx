"use client";
import { useMemo, useState } from "react";
import type { MindmapGraph, MindmapNode } from "@/lib/ai/types";
import { useSound } from "../sound-provider";

type Branch = { node: MindmapNode; children: Branch[] };

function toBranches(graph: MindmapGraph): Branch | null {
  const root = graph.nodes.find((n) => n.parentId === null);
  if (!root) return null;
  const kids = new Map<string, MindmapNode[]>();
  for (const n of graph.nodes) if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  const seen = new Set<string>();
  const build = (n: MindmapNode): Branch => {
    seen.add(n.id);
    return { node: n, children: (kids.get(n.id) ?? []).filter((c) => !seen.has(c.id)).map(build) };
  };
  return build(root);
}

/**
 * The mindmap as a nested list (mindmap.md "Outline view"): the screen-reader and
 * keyboard-first way to read the map, and the easiest one on a small phone.
 */
export function MindmapOutline({ graph, emoji, onOpen }: { graph: MindmapGraph; emoji: string; onOpen: (id: string) => void }) {
  const tree = useMemo(() => toBranches(graph), [graph]);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const { play } = useSound();
  if (!tree) return null;

  const toggle = (id: string) => {
    play("click");
    setClosed((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };

  const item = (b: Branch, depth: number) => {
    const open = !closed.has(b.node.id);
    const hasKids = b.children.length > 0;
    return (
      <li key={b.node.id} role="treeitem" aria-expanded={hasKids ? open : undefined} aria-level={depth - 1} aria-selected={false}
        className={depth === 2 ? "sticker-flat p-3" : ""}>
        <div className="flex flex-wrap items-center gap-2">
          {hasKids ? (
            <button type="button" className="btn btn-sm icon-btn min-h-11" aria-label={`${open ? "Collapse" : "Expand"} ${b.node.label}`} onClick={() => toggle(b.node.id)}>
              <span aria-hidden="true">{open ? "▾" : "▸"}</span>
            </button>
          ) : null}
          <span className={`min-w-0 flex-1 break-words ${depth <= 2 ? "font-bold" : ""} ${depth === 2 ? "text-lg" : ""}`}>{b.node.label}</span>
          {b.node.detail && <p className="w-full basis-full text-sm" data-testid="outline-detail">{b.node.detail}</p>}
          {b.node.chunkId && (
            <button type="button" data-outline-node={b.node.id} className="btn btn-sm min-h-11" aria-label={`Show passage: ${b.node.label}`} onClick={() => { play("click"); onOpen(b.node.id); }}>
              Show passage
            </button>
          )}
        </div>
        {hasKids && open && (
          <ul role="group" className={`mt-2 flex flex-col gap-2 ${depth >= 2 ? "border-l-2 border-ink pl-4" : ""}`}>
            {b.children.map((c) => item(c, depth + 1))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <div className="flex flex-col gap-4" data-testid="mindmap-outline">
      <p className="font-display text-2xl"><span aria-hidden="true">{emoji} </span>{tree.node.label}</p>
      <ul role="tree" aria-label={`Outline of ${tree.node.label}`} className="flex flex-col gap-3">
        {tree.children.map((c) => item(c, 2))}
      </ul>
    </div>
  );
}
