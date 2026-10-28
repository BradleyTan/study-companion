// Radial layout for the mindmap tree (d3-hierarchy, ISC licence): root in the centre,
// level-1 topics evenly around it, children fanned outward. Saved positions win.
import { hierarchy, tree } from "d3-hierarchy";
import type { MindmapGraph, MindmapNode } from "@/lib/ai/types";

export const RING_GAP = 280; // px between levels

type TreeDatum = { node: MindmapNode; children: TreeDatum[] };

function toTree(graph: MindmapGraph): TreeDatum | null {
  const root = graph.nodes.find((n) => n.parentId === null);
  if (!root) return null;
  const kids = new Map<string, MindmapNode[]>();
  for (const n of graph.nodes) if (n.parentId) kids.set(n.parentId, [...(kids.get(n.parentId) ?? []), n]);
  const seen = new Set<string>();
  const build = (n: MindmapNode): TreeDatum => {
    seen.add(n.id);
    return { node: n, children: (kids.get(n.id) ?? []).filter((c) => !seen.has(c.id)).map(build) };
  };
  return build(root);
}

/** Room each outer topic needs on its ring when details are shown (a detailed node is ~240 px wide). */
export const DETAIL_ARC = 230;
export const RING_GAP_MAX = 700;

/**
 * Gap between rings: RING_GAP, or wider when details are shown, so the outer ring is long enough
 * for its topics to sit side by side without overlapping.
 */
export function ringGap(graph: MindmapGraph, details: boolean, leaves: number, depth: number): number {
  if (!details || !graph.nodes.some((n) => n.detail)) return RING_GAP;
  return Math.min(RING_GAP_MAX, Math.max(RING_GAP, Math.ceil((leaves * DETAIL_ARC) / (2 * Math.PI * depth))));
}

/** Automatic position (centre of each node) for every node in the tree. */
export function radialLayout(graph: MindmapGraph, details = false): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const data = toTree(graph);
  if (!data) return out;
  const root = hierarchy(data, (d) => d.children);
  const depth = Math.max(1, root.height);
  const gap = ringGap(graph, details, root.leaves().length, depth);
  tree<TreeDatum>()
    .size([2 * Math.PI, depth * gap])
    .separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth))(root);
  root.each((n) => {
    const angle = (n.x ?? 0) - Math.PI / 2;
    const r = n.y ?? 0;
    out.set(n.data.node.id, { x: Math.round(r * Math.cos(angle)), y: Math.round(r * Math.sin(angle)) });
  });
  return out;
}

/** Position to draw each node at: the student's saved one, else the automatic one. */
export function positionsFor(graph: MindmapGraph, details = false): Map<string, { x: number; y: number }> {
  const auto = radialLayout(graph, details);
  for (const n of graph.nodes) if (n.position) auto.set(n.id, n.position);
  return auto;
}

/** Nodes in tree order (root, then depth-first): the Tab order and the outline order. */
export function treeOrder(graph: MindmapGraph): { node: MindmapNode; depth: number; childCount: number }[] {
  const data = toTree(graph);
  const out: { node: MindmapNode; depth: number; childCount: number }[] = [];
  const walk = (d: TreeDatum, depth: number) => {
    out.push({ node: d.node, depth, childCount: d.children.length });
    d.children.forEach((c) => walk(c, depth + 1));
  };
  if (data) walk(data, 0);
  return out;
}

/** Applies moved positions (rounded to whole px) to the graph, ignoring unknown ids. */
export function withPositions(graph: MindmapGraph, moved: { id: string; x: number; y: number }[]): MindmapGraph {
  const byId = new Map(moved.map((m) => [m.id, { x: Math.round(m.x), y: Math.round(m.y) }]));
  return { ...graph, nodes: graph.nodes.map((n) => (byId.has(n.id) ? { ...n, position: byId.get(n.id) } : n)) };
}

/** Drops every saved position ("Reset layout"). */
export function withoutPositions(graph: MindmapGraph): MindmapGraph {
  return { ...graph, nodes: graph.nodes.map(({ position, ...n }) => { void position; return n; }) };
}
