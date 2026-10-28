// Study notes as an editor document (make-notes.md "The new note"): Tiptap JSON the note editor
// opens as-is, plus the plain text the editor would save for it (blocks joined by a blank line),
// so the new note gets its passages straight away and works with flashcards, mindmaps and chat.
import type { StudyNotes } from "../ai/notes";

type Mark = { type: "bold" };
type TextNode = { type: "text"; text: string; marks?: Mark[] };
type Block =
  | { type: "paragraph"; content: TextNode[] }
  | { type: "heading"; attrs: { level: 2 }; content: TextNode[] }
  | { type: "bulletList"; content: { type: "listItem"; content: { type: "paragraph"; content: TextNode[] }[] }[] };

const t = (text: string, bold = false): TextNode => (bold ? { type: "text", text, marks: [{ type: "bold" }] } : { type: "text", text });
const para = (...content: TextNode[]): Block => ({ type: "paragraph", content });
const heading = (text: string): Block => ({ type: "heading", attrs: { level: 2 }, content: [t(text)] });
const bullets = (items: TextNode[][]): Block => ({ type: "bulletList", content: items.map((c) => ({ type: "listItem", content: [{ type: "paragraph", content: c }] })) });

/** "Made from Lecture 3.pdf, pages 1–12." / "Made from https://…" — the first line of the note. */
export function madeFromText(from: string): string {
  return `✨ Study notes made from ${from}. Check them against the original before you rely on them.`;
}

export function notesDocument(notes: StudyNotes, from: string): { title: string; contentJson: { type: "doc"; content: Block[] }; contentText: string } {
  const blocks: Block[] = [para(t(madeFromText(from)))];
  const lines: string[] = [madeFromText(from)];
  for (const s of notes.sections) {
    blocks.push(heading(s.heading), bullets(s.points.map((p) => [t(p.text)])));
    lines.push(s.heading, ...s.points.map((p) => p.text));
  }
  if (notes.terms.length) {
    blocks.push(heading("Key terms"), bullets(notes.terms.map((k) => [t(k.term, true), t(`: ${k.definition}`)])));
    lines.push("Key terms", ...notes.terms.map((k) => `${k.term}: ${k.definition}`));
  }
  return { title: notes.title, contentJson: { type: "doc", content: blocks }, contentText: lines.join("\n\n") };
}
