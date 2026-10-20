import { describe, expect, it } from "vitest";
import { addManual, applyMiss, cleanTopic, topicKey, undoMiss, type WeakState } from "./weak";

const NOW = "2026-10-20T10:00:00.000Z";

describe("cleanTopic", () => {
  it("collapses whitespace, trims and turns control characters into spaces", () => {
    expect(cleanTopic("  Krebs \t  cycle \n")).toBe("Krebs cycle");
    expect(cleanTopic("a\u0000b\u007fc")).toBe("a b c");
    expect(cleanTopic("   ")).toBe("");
  });
  it("matches the database key once cleaned", () => {
    expect(topicKey(cleanTopic(" KREBS   Cycle "))).toBe("krebs cycle");
  });
});

describe("addManual", () => {
  it("a new topic has no misses, no passages and sorts as now", () => {
    expect(addManual(null, "Krebs cycle", NOW)).toEqual({
      status: "added",
      next: { topic: "Krebs cycle", missCount: 0, rightStreak: 0, lastMissedAt: NOW, clearedAt: null, chunkIds: [], recent: [] },
    });
  });
  it("an open topic is already there", () => {
    const cur: WeakState = { topic: "Osmosis", missCount: 2, rightStreak: 1, lastMissedAt: "2026-10-01T00:00:00Z", clearedAt: null, chunkIds: ["c"], recent: [false, false, true] };
    expect(addManual(cur, "osmosis", NOW)).toEqual({ status: "already" });
  });
  it("a cleared topic reopens with its history and a fresh streak", () => {
    const cur: WeakState = { topic: "Osmosis", missCount: 2, rightStreak: 2, lastMissedAt: "2026-10-01T00:00:00Z", clearedAt: "2026-10-02T00:00:00Z", chunkIds: ["c"], recent: [false, true, true] };
    const r = addManual(cur, "osmosis", NOW);
    expect(r).toEqual({ status: "reopened", next: { ...cur, rightStreak: 0, clearedAt: null, lastMissedAt: NOW } });
  });
});

describe("a hand-added topic and later quiz misses", () => {
  it("a miss merges into the row; taking it back keeps the hand-added row", () => {
    const start = (addManual(null, "Krebs cycle", NOW) as { next: WeakState }).next;
    const { next, prev } = applyMiss(start, "krebs cycle", "chunk-1", "2026-10-21T10:00:00.000Z");
    expect(next).toMatchObject({ topic: "Krebs cycle", missCount: 1, chunkIds: ["chunk-1"], recent: [false] });
    expect(prev.existed).toBe(true);
    const undone = undoMiss(next, prev);
    expect(undone).toMatchObject({ topic: "Krebs cycle", missCount: 0, lastMissedAt: NOW, clearedAt: null });
  });
  it("a topic that only came from that miss is still deleted on undo", () => {
    const { next, prev } = applyMiss(null, "Osmosis", "c", NOW);
    expect(undoMiss(next, prev)).toBeNull();
  });
});
