import { describe, expect, it } from "vitest";
import type { MindmapGraph } from "@/lib/ai/types";
import { positionsFor, radialLayout, RING_GAP, treeOrder, withoutPositions, withPositions } from "./layout";

const graph: MindmapGraph = {
  version: 1,
  nodes: [
    { id: "n0", label: "Biology", parentId: null, chunkId: null },
    { id: "n1", label: "Cells", parentId: "n0", chunkId: null },
    { id: "n2", label: "Water", parentId: "n0", chunkId: null },
    { id: "n3", label: "Energy", parentId: "n0", chunkId: null },
    { id: "n4", label: "ATP", parentId: "n1", chunkId: null },
    { id: "n5", label: "Osmosis", parentId: "n2", chunkId: null },
  ],
};
const dist = (p: { x: number; y: number }) => Math.hypot(p.x, p.y);

describe("radial layout", () => {
  it("puts the root in the centre and each level on its own ring", () => {
    const pos = radialLayout(graph);
    expect(pos.get("n0")).toEqual({ x: 0, y: 0 });
    for (const id of ["n1", "n2", "n3"]) expect(dist(pos.get(id)!)).toBeCloseTo(RING_GAP / 1, -1);
    for (const id of ["n4", "n5"]) expect(dist(pos.get(id)!)).toBeCloseTo(2 * RING_GAP, -1);
  });

  it("spreads level-1 topics around the root without overlaps", () => {
    const pos = radialLayout(graph);
    const pts = ["n1", "n2", "n3"].map((id) => pos.get(id)!);
    for (let i = 0; i < pts.length; i++)
      for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(200);
  });

  it("is deterministic and copes with a lone root or no root", () => {
    expect(radialLayout(graph)).toEqual(radialLayout(graph));
    expect(radialLayout({ version: 1, nodes: [graph.nodes[0]] }).get("n0")).toEqual({ x: 0, y: 0 });
    expect(radialLayout({ version: 1, nodes: [] }).size).toBe(0);
  });

  it("lets saved positions win and can reset them", () => {
    const moved = withPositions(graph, [{ id: "n4", x: 10.4, y: -20.6 }, { id: "nope", x: 1, y: 1 }]);
    expect(positionsFor(moved).get("n4")).toEqual({ x: 10, y: -21 });
    expect(positionsFor(moved).get("n5")).toEqual(radialLayout(graph).get("n5"));
    expect(moved.nodes).toHaveLength(6);
    expect(withoutPositions(moved).nodes.every((n) => !n.position)).toBe(true);
  });
});

describe("tree order", () => {
  it("is root first, then depth-first, with depth and child counts", () => {
    expect(treeOrder(graph).map((t) => [t.node.id, t.depth, t.childCount])).toEqual([
      ["n0", 0, 3], ["n1", 1, 1], ["n4", 2, 0], ["n2", 1, 1], ["n5", 2, 0], ["n3", 1, 0],
    ]);
  });
});
