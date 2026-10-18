import { describe, expect, it } from "vitest";
import { attemptOrder, band, hasRunOfThree, interleave, nextHeading, permutation, quizTitle, shuffle, CORRECT_HEADINGS } from "./order";
import { applyMiss, applyRight, recentText, sortOpen, topicKey, undoMiss, type WeakState } from "./weak";

/** Deterministic rng for tests. */
function seeded(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; };
}

describe("weak topics: tracking rules", () => {
  const t0 = "2026-10-18T10:00:00.000Z";
  const t1 = "2026-10-18T11:00:00.000Z";
  const t2 = "2026-10-18T12:00:00.000Z";

  it("matches topics case-insensitively and trimmed", () => {
    expect(topicKey("  Krebs   Cycle ")).toBe("krebs cycle");
    expect(topicKey("KREBS cycle")).toBe(topicKey("krebs cycle"));
  });

  it("a first miss creates the topic with one miss and remembers the passage", () => {
    const { next, prev } = applyMiss(null, "Osmosis", "c1", t0);
    expect(next).toEqual({ topic: "Osmosis", missCount: 1, rightStreak: 0, lastMissedAt: t0, clearedAt: null, chunkIds: ["c1"], recent: [false] });
    expect(prev.existed).toBe(false);
  });

  it("a miss adds one, resets the streak and reopens a cleared topic", () => {
    const cur: WeakState = { topic: "Osmosis", missCount: 2, rightStreak: 1, lastMissedAt: t0, clearedAt: t1, chunkIds: ["c1"], recent: [false, true] };
    const { next, prev } = applyMiss(cur, "osmosis", "c2", t2);
    expect(next.missCount).toBe(3);
    expect(next.rightStreak).toBe(0);
    expect(next.clearedAt).toBeNull();
    expect(next.topic).toBe("Osmosis"); // keeps its first spelling
    expect(next.chunkIds).toEqual(["c2", "c1"]);
    expect(prev).toEqual({ existed: true, rightStreak: 1, clearedAt: t1, lastMissedAt: t0 });
  });

  it("keeps at most 10 passages, most recent first, without repeats", () => {
    let s: WeakState | null = null;
    for (let i = 0; i < 12; i++) s = applyMiss(s, "T", `c${i % 11}`, t0).next;
    expect(s!.chunkIds).toHaveLength(10);
    expect(s!.chunkIds[0]).toBe("c0");
    expect(new Set(s!.chunkIds).size).toBe(10);
  });

  it("two right in a row clear a topic; one right is getting stronger", () => {
    const open = applyMiss(null, "T", null, t0).next;
    const one = applyRight(open, t1)!;
    expect(one.rightStreak).toBe(1);
    expect(one.clearedAt).toBeNull();
    const two = applyRight(one, t2)!;
    expect(two.rightStreak).toBe(2);
    expect(two.clearedAt).toBe(t2);
    expect(two.recent).toEqual([false, true, true]);
  });

  it("a miss between rights starts the streak again", () => {
    let s = applyMiss(null, "T", null, t0).next;
    s = applyRight(s, t1)!;
    s = applyMiss(s, "T", null, t1).next;
    s = applyRight(s, t2)!;
    expect(s.rightStreak).toBe(1);
    expect(s.clearedAt).toBeNull();
  });

  it("a right answer changes nothing without an open topic", () => {
    expect(applyRight(null, t0)).toBeNull();
    const cleared: WeakState = { topic: "T", missCount: 1, rightStreak: 2, lastMissedAt: t0, clearedAt: t1, chunkIds: [], recent: [] };
    expect(applyRight(cleared, t2)).toBeNull();
  });

  it("keeps the last 5 tries", () => {
    let s = applyMiss(null, "T", null, t0).next;
    for (let i = 0; i < 6; i++) s = i % 2 ? applyMiss(s, "T", null, t0).next : applyRight(s, t0) ?? s;
    expect(s.recent).toHaveLength(5);
    expect(recentText([false, false, true])).toBe("Last 3 tries: missed, missed, right");
  });

  it("'I was right' undoes the miss: a first miss deletes the topic", () => {
    const { next, prev } = applyMiss(null, "T", "c1", t0);
    expect(undoMiss(next, prev)).toBeNull();
  });

  it("'I was right' restores the streak, cleared state and last miss", () => {
    const before: WeakState = { topic: "T", missCount: 2, rightStreak: 1, lastMissedAt: t0, clearedAt: null, chunkIds: ["c1"], recent: [false, true] };
    const { next, prev } = applyMiss(before, "T", "c2", t1);
    const undone = undoMiss(next, prev)!;
    expect(undone.missCount).toBe(2);
    expect(undone.rightStreak).toBe(1);
    expect(undone.lastMissedAt).toBe(t0);
    expect(undone.clearedAt).toBeNull();
    expect(undone.recent).toEqual([false, true, true]);

    const cleared: WeakState = { ...before, rightStreak: 2, clearedAt: t1 };
    const reopened = applyMiss(cleared, "T", null, t2);
    expect(undoMiss(reopened.next, reopened.prev)!.clearedAt).toBe(t1);
  });

  it("'I was right' later never wipes rights or a clear that came after the miss (QA step 3)", () => {
    const before: WeakState = { topic: "T", missCount: 1, rightStreak: 0, lastMissedAt: t0, clearedAt: null, chunkIds: ["c1"], recent: [false] };
    const { next, prev } = applyMiss(before, "T", "c1", t1);
    // Two right answers clear the topic, then the older miss is overridden.
    const cleared = applyRight(applyRight(next, t2)!, t2)!;
    expect(cleared.clearedAt).toBe(t2);
    const undone = undoMiss(cleared, prev)!;
    expect(undone.clearedAt).toBe(t2);
    expect(undone.rightStreak).toBe(2);
    expect(undone.missCount).toBe(1);
    // One right since the miss: the streak stays.
    const stronger = applyRight(next, t2)!;
    expect(undoMiss(stronger, prev)!.rightStreak).toBe(1);
    // Marked as got it since the miss: stays cleared.
    expect(undoMiss({ ...next, clearedAt: t2 }, prev)!.clearedAt).toBe(t2);
  });

  it("orders the open list by most recent miss, then more misses", () => {
    const list = [
      { id: "a", lastMissedAt: t0, missCount: 5 },
      { id: "b", lastMissedAt: t2, missCount: 1 },
      { id: "c", lastMissedAt: t2, missCount: 3 },
    ];
    expect(sortOpen(list).map((x) => x.id)).toEqual(["c", "b", "a"]);
  });
});

describe("question order", () => {
  const q = (type: "mcq" | "fill", i: number) => ({ id: `${type}${i}`, type, options: type === "mcq" ? ["a", "b", "c", "d"] : null });

  it("interleaves mixed quizzes without three of a type in a row when avoidable", () => {
    const list = [q("mcq", 1), q("mcq", 2), q("mcq", 3), q("mcq", 4), q("fill", 1), q("fill", 2), q("fill", 3)];
    const out = interleave(list);
    expect(out).toHaveLength(7);
    expect(hasRunOfThree(out)).toBe(false);
    // Order inside each type is kept.
    expect(out.filter((x) => x.type === "mcq").map((x) => x.id)).toEqual(["mcq1", "mcq2", "mcq3", "mcq4"]);
  });

  it("allows runs only when there is no other type left", () => {
    const out = interleave([q("mcq", 1), q("mcq", 2), q("mcq", 3), q("mcq", 4), q("fill", 1)]);
    expect(out.map((x) => x.type)).toEqual(["mcq", "mcq", "fill", "mcq", "mcq"]);
  });

  it("shuffles fairly and keeps every element", () => {
    const rng = seeded(7);
    const counts = [0, 0, 0, 0];
    for (let i = 0; i < 4000; i++) counts[permutation(4, rng).indexOf(0)]++;
    for (const c of counts) expect(c).toBeGreaterThan(850);
    expect(shuffle([1, 2, 3], rng).sort()).toEqual([1, 2, 3]);
  });

  it("first attempt keeps the quiz order; a retake reshuffles; options always get an order", () => {
    const list = [q("mcq", 1), q("fill", 1), q("mcq", 2), q("fill", 2), q("mcq", 3)];
    const first = attemptOrder(list, false, seeded(1));
    expect(first.map((s) => s.q)).toEqual(list.map((x) => x.id));
    expect(first[0].o!.slice().sort()).toEqual([0, 1, 2, 3]);
    expect(first[1].o).toBeNull();
    const orders = new Set(Array.from({ length: 10 }, (_, i) => attemptOrder(list, true, seeded(i + 2)).map((s) => s.q).join()));
    expect(orders.size).toBeGreaterThan(1);
    for (const o of orders) expect(hasRunOfThree(o.split(",").map((id) => ({ type: id.startsWith("mcq") ? "mcq" as const : "fill" as const })))).toBe(false);
  });
});

describe("results and copy", () => {
  it("bands scores like the spec", () => {
    expect(band(9, 10)).toBe("brilliant");
    expect(band(7, 10)).toBe("nice");
    expect(band(8, 10)).toBe("nice");
    expect(band(5, 10)).toBe("getting");
    expect(band(4, 10)).toBe("practice");
    expect(band(0, 0)).toBe("practice");
  });
  it("builds titles on the server", () => {
    expect(quizTitle({ kind: "file", name: "Lecture 3.pdf", range: "pages 1–20" }, "mixed")).toBe("Lecture 3.pdf · pages 1–20 · Mixed");
    expect(quizTitle({ kind: "note", name: "Cell structure" }, "mcq")).toBe("Cell structure · Multiple choice");
    expect(quizTitle({ kind: "all", name: "Biology" }, "fill")).toBe("All of Biology · Fill in the blank");
    expect(quizTitle({ kind: "weak", name: "" }, "mixed")).toBe("Weak topics · Mixed");
  });
  it("never repeats a heading twice in a row", () => {
    const rng = seeded(3);
    let last: string | null = null;
    for (let i = 0; i < 50; i++) {
      const h: string = nextHeading(CORRECT_HEADINGS, last, rng);
      expect(h).not.toBe(last);
      last = h;
    }
  });
});
