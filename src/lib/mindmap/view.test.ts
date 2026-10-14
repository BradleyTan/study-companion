import { describe, expect, it } from "vitest";
import type { MindmapGraph } from "@/lib/ai/types";
import { edgeSides, entranceOrder, madeFromLine, nodeLabel, nudge, retryDelay } from "./view";

const g: MindmapGraph = {
  version: 1,
  nodes: [
    { id: "n0", label: "Bio", parentId: null, chunkId: null },
    { id: "n1", label: "Cells", parentId: "n0", chunkId: null },
    { id: "n2", label: "Mito", parentId: "n1", chunkId: "c" },
    { id: "n3", label: "Plants", parentId: "n0", chunkId: null },
  ],
};

describe("mindmap view helpers", () => {
  it("picks edge sides by the main direction", () => {
    expect(edgeSides({ x: 0, y: 0 }, { x: 100, y: 10 })).toEqual({ source: "right", target: "left" });
    expect(edgeSides({ x: 0, y: 0 }, { x: -100, y: 10 })).toEqual({ source: "left", target: "right" });
    expect(edgeSides({ x: 0, y: 0 }, { x: 5, y: 100 })).toEqual({ source: "bottom", target: "top" });
    expect(edgeSides({ x: 0, y: 0 }, { x: 5, y: -100 })).toEqual({ source: "top", target: "bottom" });
  });
  it("builds the accessible node name", () => {
    expect(nodeLabel("Photosynthesis", 1, 3, true)).toBe("Photosynthesis, topic, 3 subtopics, has a source passage");
    expect(nodeLabel("Leaf", 2, 1, false)).toBe("Leaf, subtopic, 1 subtopic");
    expect(nodeLabel("Biology", 0, 0, false)).toBe("Biology, main subject");
  });
  it("writes the made-from line", () => {
    expect(madeFromLine(4, 2)).toBe("Made from 4 notes and 2 files");
    expect(madeFromLine(1, 0)).toBe("Made from 1 note");
    expect(madeFromLine(0, 1)).toBe("Made from 1 file");
  });
  it("orders the entrance root outward", () => {
    const o = entranceOrder(g);
    expect(o.get("n0")).toBe(0);
    expect(o.get("n1")).toBe(1);
    expect(o.get("n3")).toBe(2);
    expect(o.get("n2")).toBe(3);
  });
  it("nudges by 10 or 50 px", () => {
    expect(nudge({ x: 0, y: 0 }, "ArrowUp", false)).toEqual({ x: 0, y: -10 });
    expect(nudge({ x: 0, y: 0 }, "ArrowRight", true)).toEqual({ x: 50, y: 0 });
    expect(nudge({ x: 0, y: 0 }, "a", false)).toBeNull();
  });
  it("backs off retries up to 30 s", () => {
    expect([0, 1, 2, 10].map(retryDelay)).toEqual([1000, 2000, 4000, 30000]);
  });
});
