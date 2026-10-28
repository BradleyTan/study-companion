import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { Packer } from "docx";
import { noteDocument, noteFileName, type TiptapNode } from "./docx";

const t = (text: string, ...marks: string[]): TiptapNode => ({ type: "text", text, marks: marks.map((type) => ({ type })) });
const p = (...content: TiptapNode[]): TiptapNode => ({ type: "paragraph", content });
const li = (...content: TiptapNode[]): TiptapNode => ({ type: "listItem", content });

async function xml(title: string, doc: TiptapNode) {
  const zip = await JSZip.loadAsync(await Packer.toBuffer(noteDocument(title, doc)));
  return { body: await zip.file("word/document.xml")!.async("string"), numbering: await zip.file("word/numbering.xml")!.async("string") };
}

describe("note to Word", () => {
  it("keeps the title, headings, bold and italic text, lists and code", async () => {
    const { body } = await xml("Study notes: Routing", {
      type: "doc",
      content: [
        p(t("✨ Study notes made from Lecture 3.pdf.")),
        { type: "heading", attrs: { level: 2 }, content: [t("Static routes")] },
        { type: "bulletList", content: [li(p(t("Administrative distance", "bold"), t(": 1 by default"))), li(p(t("nested")), { type: "bulletList", content: [li(p(t("deeper")))] })] },
        { type: "orderedList", content: [li(p(t("first step", "italic")))] },
        { type: "codeBlock", content: [t("ip route 192.168.1.0 255.255.255.0 200.0.0.1\nno ip route 10.0.0.0 255.0.0.0 1.1.1.1")] },
        { type: "blockquote", content: [p(t("a quote"))] },
        p(t("line one"), { type: "hardBreak" }, t("line two")),
      ],
    });
    expect(body).toContain('<w:pStyle w:val="Title"/>');
    expect(body).toContain("Study notes: Routing");
    expect(body).toContain('<w:pStyle w:val="Heading2"/>');
    expect(body).toMatch(/<w:b\/>[\s\S]*?Administrative distance/);
    expect(body).toMatch(/<w:i\/>[\s\S]*?first step/);
    expect(body).toMatch(/<w:ilvl w:val="1"\/>[\s\S]*?deeper/);
    expect(body).toContain("ip route 192.168.1.0 255.255.255.0 200.0.0.1");
    expect(body).toContain("no ip route 10.0.0.0");
    expect(body).toContain("Courier New");
    expect(body).toContain("<w:br/>");
  });

  it("escapes XML in the text and copes with an empty note", async () => {
    const { body } = await xml("", { type: "doc", content: [p(t("a < b & c > d")), p()] });
    expect(body).toContain("a &lt; b &amp; c &gt; d");
    expect(body).toContain("Untitled note");
    await expect(xml("x", { type: "doc" })).resolves.toBeTruthy();
  });

  it("restarts numbering for each numbered list", async () => {
    const list = { type: "orderedList", content: [li(p(t("one"))), li(p(t("two")))] };
    const { body } = await xml("n", { type: "doc", content: [list, p(t("between")), list] });
    const ids = [...body.matchAll(/<w:numId w:val="(\d+)"\/>/g)].map((m) => m[1]);
    expect(ids).toHaveLength(4);
    expect(ids[0]).toBe(ids[1]);
    expect(ids[2]).not.toBe(ids[0]);
  });

  it("makes a safe file name from the title", () => {
    expect(noteFileName("Study notes: Routing Concepts", "docx")).toBe("Study notes - Routing Concepts.docx");
    expect(noteFileName('a/b\\c*?"<>|', "docx")).toBe("a - b - c.docx");
    expect(noteFileName("   ", "docx")).toBe("Untitled note.docx");
    expect(noteFileName("..", "docx")).toBe("Untitled note.docx");
    expect(noteFileName("x".repeat(300), "docx")).toHaveLength(105);
  });
});
