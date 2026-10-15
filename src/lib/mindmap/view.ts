// Small pure helpers for drawing the mindmap (kept apart from React Flow so they're testable).
import type { MindmapGraph } from "@/lib/ai/types";
import { treeOrder } from "./layout";

export type Side = "top" | "right" | "bottom" | "left";
const OPPOSITE: Record<Side, Side> = { top: "bottom", right: "left", bottom: "top", left: "right" };

/** Which side of the parent the edge leaves from (and the child's side it enters), by direction. */
export function edgeSides(parent: { x: number; y: number }, child: { x: number; y: number }): { source: Side; target: Side } {
  const dx = child.x - parent.x;
  const dy = child.y - parent.y;
  const source: Side = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? "right" : "left") : dy >= 0 ? "bottom" : "top";
  return { source, target: OPPOSITE[source] };
}

/** "Photosynthesis, topic, 3 subtopics, has a source passage" (mindmap.md Accessibility). */
export function nodeLabel(label: string, depth: number, childCount: number, hasPassage: boolean): string {
  const parts = [label, depth === 0 ? "main subject" : depth === 1 ? "topic" : "subtopic"];
  if (childCount > 0) parts.push(`${childCount} ${childCount === 1 ? "subtopic" : "subtopics"}`);
  if (hasPassage) parts.push("has a source passage");
  return parts.join(", ");
}

/** "Made from 4 notes and 2 files". */
export function madeFromLine(notes: number, files: number): string {
  const p = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  if (notes && files) return `Made from ${p(notes, "note")} and ${p(files, "file")}`;
  if (files) return `Made from ${p(files, "file")}`;
  return `Made from ${p(notes, "note")}`;
}

/** Order of appearance for the "grow from the root" entrance: by depth, then tree order. */
export function entranceOrder(graph: MindmapGraph): Map<string, number> {
  const order = treeOrder(graph);
  const sorted = [...order].sort((a, b) => a.depth - b.depth || order.indexOf(a) - order.indexOf(b));
  return new Map(sorted.map((o, i) => [o.node.id, i]));
}

/** Moves a point by an arrow key: 10 px, or 50 px with Shift (mindmap.md Keyboard). */
export function nudge(pos: { x: number; y: number }, key: string, shift: boolean): { x: number; y: number } | null {
  const step = shift ? 50 : 10;
  switch (key) {
    case "ArrowUp": return { x: pos.x, y: pos.y - step };
    case "ArrowDown": return { x: pos.x, y: pos.y + step };
    case "ArrowLeft": return { x: pos.x - step, y: pos.y };
    case "ArrowRight": return { x: pos.x + step, y: pos.y };
    default: return null;
  }
}

/** Backoff for retrying a failed layout save: 1 s, 2 s, 4 s … capped at 30 s. */
export const retryDelay = (attempt: number) => Math.min(30_000, 1000 * 2 ** attempt);
