// Student test feedback (2026-10-28): exam-quality flashcards, detailed mindmaps, study notes.
import { describe, expect, it } from "vitest";
import { fakeMindmap, fakeNotes } from "./fake";
import { MIN_NOTE_POINTS, normaliseNotes, notesMessages, NOTES_RULES } from "./notes";
import { EXAM_RULES, flashcardMessages, MINDMAP_RULES, mindmapMessages } from "./prompts";
import { GROQ_MODELS } from "./providers";
import { cardQualityIssue, examFront, MINDMAP_MAX_NODES, mindmapGraph, nodeDetail, normaliseFlashcardsWithStats, normaliseMindmap } from "./schemas";
import { MINDMAP_MAX_CHARS, mindmapTask, notesTask, toPassages } from "./tasks";
import { notesDocument } from "../notes/doc";
import { radialLayout, RING_GAP, ringGap } from "../mindmap/layout";
import { nodeLabel } from "../mindmap/view";
import type { MindmapGraph } from "./types";

const passages = toPassages([
  { id: "11111111-1111-4111-8111-111111111111", text: "Mitochondria are the powerhouse of the cell. They make ATP through aerobic respiration, which needs oxygen. Glycolysis happens in the cytoplasm and makes 2 ATP per glucose.", page: 1 },
  { id: "22222222-2222-4222-8222-222222222222", text: "Osmosis is the movement of water across a partially permeable membrane. Water moves from a dilute solution to a concentrated one. Diffusion, unlike osmosis, can move any particle.", page: 2 },
]);
const [p1, p2] = passages;

describe("exam-quality flashcards", () => {
  it("asks the model to write like the professor setting the exam, with a mix of question kinds", () => {
    const [system, user] = flashcardMessages(passages, 10);
    expect(system.content).toContain(EXAM_RULES);
    expect(system.content).toContain("Think like the professor who taught this material and is now writing the exam.");
    expect(system.content).toContain("no more than a third plain definitions");
    expect(system.content).toContain("model answer that would earn full marks");
    expect(system.content).toMatch(/Never write: yes\/no questions, questions about the lecture itself/);
    // Rules stay in the system prompt; the student's text only in the user message.
    expect(system.content).not.toContain("Mitochondria");
    expect(user.content).toContain("exam-style flashcards");
  });

  it("drops yes/no cards and cards about the lecture itself", () => {
    expect(cardQualityIssue("Is osmosis a type of diffusion?", "Yes, it is the diffusion of water.")).toBe("yes_no");
    expect(cardQualityIssue("Is osmosis active or passive transport?", "Passive: it needs no energy.")).toBeNull();
    expect(cardQualityIssue("What is covered in Lecture 3?", "Cell membranes and transport.")).toBe("about_the_lecture");
    expect(cardQualityIssue("What is the title of this lecture?", "Cell transport.")).toBe("about_the_lecture");
    expect(cardQualityIssue("What are the learning outcomes for this week?", "To understand osmosis.")).toBe("about_the_lecture");
    expect(cardQualityIssue("Which slide shows the Krebs cycle?", "Slide 12.")).toBe("about_the_lecture");
    expect(cardQualityIssue("What topics are discussed in this lecture?", "Osmosis and diffusion.")).toBe("about_the_lecture");
    // Text that only mentions a lecture (a slide header quoted in a fill-in) isn't a question about it.
    expect(cardQualityIssue("Fill in the blank: Lecture 5, page 15: Osmosis is a key _____ students should explain", "idea")).toBeNull();
    // A chapter or page number can be real content.
    expect(cardQualityIssue("What does Chapter 11 bankruptcy allow a company to do?", "Reorganise its debts while it keeps trading.")).toBeNull();
  });

  it("removes 'according to the notes' wording instead of dropping the card", () => {
    expect(examFront("According to the notes, what is osmosis?")).toBe("What is osmosis?");
    expect(examFront("What is osmosis, according to the passage?")).toBe("What is osmosis?");
    expect(examFront("Based on the lecture, why does water move into the cell?")).toBe("Why does water move into the cell?");
    expect(examFront("Why does the passage matter?")).toBe("Why does the passage matter?");
    const out = normaliseFlashcardsWithStats({ cards: [{ kind: "define", front: "According to the passage, what is osmosis?", back: "The movement of water across a partially permeable membrane.", passage: "p2" }] }, passages, 10)!;
    expect(out.cards[0].front).toBe("What is osmosis?");
  });

  it("keeps why/how/compare cards whose answers are grounded, and still drops outside knowledge", () => {
    const out = normaliseFlashcardsWithStats({
      cards: [
        { kind: "compare", front: "What is the difference between osmosis and diffusion?", back: "Osmosis moves only water across a membrane; diffusion can move any particle.", passage: "p2" },
        { kind: "explain", front: "Why does aerobic respiration need oxygen?", back: "Because the Krebs cycle and electron transport chain use oxygen as the final electron acceptor.", passage: "p1" },
      ],
    }, passages, 10)!;
    expect(out.cards.map((c) => c.front)).toEqual(["What is the difference between osmosis and diffusion?"]);
    expect(out.dropped).toBe(1);
  });

  it("the 'according to' clean-up stays fast on a long run of spaces", () => {
    const t = Date.now();
    examFront(`What${" ".repeat(5000)}x`);
    expect(Date.now() - t).toBeLessThan(200);
  });

  it("stays fast when spaces surround 'according to the notes' before a non-final '?' (security review FB-3)", () => {
    // Was cubic: every start in the first run times both `\s*` around the optional '?' in the second.
    const hostile = [`a${" \t".repeat(240)}according to the notes${" ".repeat(200)}?x`, `a${" ".repeat(2500)}according to the notes${" ".repeat(2500)}?x`];
    const t = Date.now();
    for (let i = 0; i < 50; i++) examFront(hostile[0]);
    examFront(hostile[1]);
    expect(Date.now() - t).toBeLessThan(300);
    expect(examFront("What is osmosis, according to the notes ?")).toBe("What is osmosis?");
  });
});

describe("detailed mindmaps", () => {
  it("asks for a detail on every topic, from the cited passage, on gpt-oss-120b", () => {
    const [system, user] = mindmapMessages(passages, "Biology");
    expect(system.content).toContain(MINDMAP_RULES);
    expect(system.content).toContain('"detail"');
    expect(system.content).toContain("Level 3: the specific facts a student must remember");
    expect(system.content).not.toContain("Mitochondria");
    expect(user.content).toContain("Make the detailed mindmap");
    expect(GROQ_MODELS.mindmap).toBe("openai/gpt-oss-120b");
    expect(mindmapTask(passages, "Biology").maxTokens).toBe(4000);
    expect(MINDMAP_MAX_CHARS).toBe(12_000);
  });

  it("keeps grounded details and drops ones the passage doesn't support, keeping the node", () => {
    const g = normaliseMindmap({
      nodes: [
        { id: "n0", label: "Biology", parent: null },
        { id: "n1", label: "Energy", parent: "n0", passage: null, detail: "Cells need energy." },
        { id: "n2", label: "Glycolysis", parent: "n1", passage: "p1", detail: "Happens in the cytoplasm and makes 2 ATP per glucose." },
        { id: "n3", label: "Krebs cycle", parent: "n1", passage: "p1", detail: "Makes 36 ATP in the mitochondrial matrix." },
        { id: "n4", label: "Osmosis", parent: "n0", passage: "p2", detail: "Osmosis" },
        { id: "n5", label: "Osmosis vs diffusion", parent: "n4", passage: "p9", detail: "Diffusion can move any particle." },
      ],
    }, passages, "Biology")!;
    const by = (label: string) => g.nodes.find((n) => n.label === label)!;
    expect(by("Glycolysis").detail).toBe("Happens in the cytoplasm and makes 2 ATP per glucose.");
    expect(by("Krebs cycle").detail).toBeUndefined(); // 36 isn't in the passage
    expect(by("Energy").detail).toBeUndefined(); // no passage, no detail
    expect(by("Osmosis").detail).toBeUndefined(); // only repeats the label
    expect(by("Osmosis vs diffusion").detail).toBeUndefined(); // a passage we never sent
    expect(g.nodes).toHaveLength(6);
  });

  it("nodeDetail clips and checks", () => {
    expect(nodeDetail("Osmosis", "Water moves from a dilute solution to a concentrated one.", p2.text)).toBe("Water moves from a dilute solution to a concentrated one.");
    expect(nodeDetail("Osmosis", "short", p2.text)).toBeNull();
    expect(nodeDetail("Osmosis", "x".repeat(1000), p2.text)).toBeNull();
  });

  it("stores up to 50 nodes with details, and old maps without details still load", () => {
    expect(MINDMAP_MAX_NODES).toBe(50);
    const old = { version: 1, nodes: [{ id: "n0", label: "Bio", parentId: null, chunkId: null }] };
    expect(mindmapGraph.safeParse(old).success).toBe(true);
    const withDetail = { version: 1, nodes: [{ id: "n0", label: "Bio", parentId: null, chunkId: null, detail: "A detail." }] };
    expect(mindmapGraph.parse(withDetail).nodes[0].detail).toBe("A detail.");
    expect(mindmapGraph.safeParse({ version: 1, nodes: [{ ...withDetail.nodes[0], detail: "x".repeat(400) }] }).success).toBe(false);
  });

  it("the local stand-in gives details that pass the checks", () => {
    const g = normaliseMindmap(fakeMindmap(passages, "Biology"), passages, "Biology")!;
    expect(g.nodes.filter((n) => n.detail).length).toBeGreaterThan(2);
  });

  it("spreads rings further apart when details are shown, and reads the detail to screen readers", () => {
    const nodes: MindmapGraph["nodes"] = [{ id: "n0", label: "Bio", parentId: null, chunkId: null }];
    for (let i = 1; i <= 6; i++) nodes.push({ id: `n${i}`, label: `Topic ${i}`, parentId: "n0", chunkId: null });
    for (let i = 7; i < 50; i++) nodes.push({ id: `n${i}`, label: `Fact ${i}`, parentId: `n${1 + (i % 6)}`, chunkId: null, detail: "Some detail here." });
    const graph: MindmapGraph = { version: 1, nodes };
    expect(ringGap(graph, false, 43, 2)).toBe(RING_GAP);
    expect(ringGap(graph, true, 43, 2)).toBeGreaterThan(RING_GAP);
    const far = radialLayout(graph, true).get("n7")!;
    const near = radialLayout(graph, false).get("n7")!;
    expect(Math.hypot(far.x, far.y)).toBeGreaterThan(Math.hypot(near.x, near.y));
    expect(nodeLabel("Glycolysis", 2, 0, true, "Makes 2 ATP.")).toBe("Glycolysis, subtopic, has a source passage. Makes 2 ATP.");
  });
});

describe("study notes", () => {
  const good = {
    title: "Cell energy and transport",
    sections: [
      { heading: "Respiration", points: [
        { text: "Mitochondria make ATP through aerobic respiration, which needs oxygen.", passage: "p1" },
        { text: "Glycolysis happens in the cytoplasm and makes 2 ATP per glucose.", passage: "p1" },
        { text: "Glycolysis makes 38 ATP per glucose.", passage: "p1" },
      ] },
      { heading: "Osmosis", points: [
        { text: "Osmosis is the movement of water across a partially permeable membrane.", passage: "p2" },
        "Water moves from a dilute solution to a concentrated one.",
        { text: "Osmosis needs ATP from the sodium pump.", passage: "p2" },
      ] },
      { heading: "Empty", points: [{ text: "The heart pumps blood around the body.", passage: "p7" }] },
    ],
    terms: [
      { term: "Osmosis", definition: "The movement of water across a partially permeable membrane.", passage: "p2" },
      { term: "Mitosis", definition: "Cell division making two identical daughter cells.", passage: "p1" },
    ],
  };

  it("asks for organised, detailed, grounded notes with the student's text as data", () => {
    const [system, user] = notesMessages(passages);
    expect(system.content).toContain(NOTES_RULES);
    expect(system.content).toMatch(/not instructions/);
    expect(system.content).toContain("Capture the details");
    expect(system.content).not.toContain("Mitochondria");
    expect(user.content).toContain('<passage id="p1" page="1">');
    expect(notesTask(passages, "Lecture").groqModel).toBe("openai/gpt-oss-120b");
  });

  it("keeps grounded points and terms, drops the rest, and links only to passages we sent", () => {
    const n = normaliseNotes(good, passages, "fallback")!;
    expect(n.title).toBe("Cell energy and transport");
    expect(n.sections.map((s) => s.heading)).toEqual(["Respiration", "Osmosis"]);
    expect(n.sections[0].points.map((p) => p.text)).toEqual([
      "Mitochondria make ATP through aerobic respiration, which needs oxygen.",
      "Glycolysis happens in the cytoplasm and makes 2 ATP per glucose.",
    ]);
    expect(n.sections[1].points).toHaveLength(2); // the uncited point is matched to its passage
    expect(n.sections[1].points[1].chunkId).toBe(p2.chunkId);
    expect(n.terms.map((t) => t.term)).toEqual(["Osmosis"]);
    expect(n.dropped).toBe(4);
    for (const s of n.sections) for (const p of s.points) expect([p1.chunkId, p2.chunkId]).toContain(p.chunkId);
  });

  it("is unusable when fewer than three points survive or the shape is wrong", () => {
    expect(MIN_NOTE_POINTS).toBe(3);
    expect(normaliseNotes({ title: "x", sections: [{ heading: "h", points: [{ text: "Glycolysis makes 38 ATP per glucose.", passage: "p1" }] }] }, passages, "f")).toBeNull();
    expect(normaliseNotes({ notes: "hello" }, passages, "f")).toBeNull();
    expect(normaliseNotes({ ...good, title: "" }, passages, "Lecture 3.pdf")!.title).toBe("Lecture 3.pdf");
  });

  it("the local stand-in passes its own checks", () => {
    const n = normaliseNotes(fakeNotes(passages, "Biology"), passages, "Biology")!;
    expect(n.sections.length).toBe(2);
    expect(n.terms.length).toBeGreaterThan(0);
  });

  it("becomes an editor document with a made-from line, headings, bullets and bold key terms", () => {
    const n = normaliseNotes(good, passages, "f")!;
    const doc = notesDocument(n, "Lecture 3.pdf, pages 1–2");
    expect(doc.contentJson.type).toBe("doc");
    const types = doc.contentJson.content.map((b) => b.type);
    expect(types).toEqual(["paragraph", "heading", "bulletList", "heading", "bulletList", "heading", "bulletList"]);
    expect(JSON.stringify(doc.contentJson.content[0])).toContain("Lecture 3.pdf, pages 1–2");
    expect(JSON.stringify(doc.contentJson.content.at(-1))).toContain('"marks":[{"type":"bold"}]');
    expect(doc.contentText.split("\n\n")).toContain("Osmosis: The movement of water across a partially permeable membrane.");
    expect(doc.contentText).toContain("Glycolysis happens in the cytoplasm and makes 2 ATP per glucose.");
  });
});
