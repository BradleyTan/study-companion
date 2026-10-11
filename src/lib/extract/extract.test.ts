import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { CHUNK_MAX, chunkPages, normaliseText } from "./chunk";
import { detectFileKind } from "./detect";
import { extractFile } from "./index";
import { decodeXml, extractPptx, slideXmlToText } from "./pptx";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`../../../e2e/fixtures/${name}`, import.meta.url)));

async function makePptx(slides: string[][], opts: { macro?: boolean; notes?: Record<number, string> } = {}) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<Types>${opts.macro ? '<Override ContentType="application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml"/>' : ""}</Types>`);
  zip.file("ppt/presentation.xml", "<p:presentation/>");
  slides.forEach((paras, i) => {
    const body = paras.map((p) => `<a:p><a:r><a:t>${p}</a:t></a:r></a:p>`).join("");
    zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld><p:txBody>${body}</p:txBody></p:sld>`);
  });
  for (const [n, text] of Object.entries(opts.notes ?? {})) {
    zip.file(`ppt/notesSlides/notesSlide${n}.xml`, `<p:notes><a:p><a:r><a:t>${text}</a:t></a:r></a:p><a:p><a:r><a:t>${n}</a:t></a:r></a:p></p:notes>`);
  }
  if (opts.macro) zip.file("ppt/vbaProject.bin", "evil");
  return zip.generateAsync({ type: "uint8array" });
}

describe("detectFileKind", () => {
  it("accepts a real PDF", async () => {
    expect(await detectFileKind(fixture("lecture.pdf"), "Lecture 1.PDF")).toEqual({ ok: true, kind: "pdf" });
  });
  it("rejects a non-PDF renamed to .pdf", async () => {
    expect((await detectFileKind(fixture("fake.pdf"), "fake.pdf")).ok).toBe(false);
  });
  it("rejects other extensions even if the bytes are a PDF", async () => {
    const r = await detectFileKind(fixture("lecture.pdf"), "lecture.exe");
    expect(r).toEqual({ ok: false, error: "Only PDF and PPTX files can be uploaded." });
  });
  it("accepts a plain pptx and rejects one with macros", async () => {
    expect(await detectFileKind(await makePptx([["Hi"]]), "deck.pptx")).toEqual({ ok: true, kind: "pptx" });
    const r = await detectFileKind(await makePptx([["Hi"]], { macro: true }), "deck.pptx");
    expect(r.ok).toBe(false);
  });
  it("rejects a zip that isn't a presentation", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "hi");
    expect((await detectFileKind(await zip.generateAsync({ type: "uint8array" }), "x.pptx")).ok).toBe(false);
  });
});

describe("pptx text", () => {
  it("decodes XML entities, including numeric ones", () => {
    expect(decodeXml("Tom &amp; Jerry &lt;3 &#233;t&#xE9;")).toBe("Tom & Jerry <3 été");
  });
  it("joins runs within a paragraph and splits paragraphs into lines", () => {
    const xml = "<a:p><a:r><a:t>Hel</a:t></a:r><a:r><a:t xml:space=\"preserve\">lo</a:t></a:r></a:p><a:p><a:r><a:t>World</a:t></a:r></a:p>";
    expect(slideXmlToText(xml)).toBe("Hello\nWorld");
  });
  it("extracts slides in numeric order with speaker notes", async () => {
    const slides = Array.from({ length: 11 }, (_, i) => [`Slide ${i + 1}`]);
    const out = await extractPptx(await makePptx(slides, { notes: { 2: "Say this out loud" } }));
    expect(out).toHaveLength(11);
    expect(out[9]).toBe("Slide 10");
    expect(out[1]).toBe("Slide 2\n\nSpeaker notes: Say this out loud");
  });
});

describe("chunking", () => {
  it("normalises whitespace and re-joins hyphenated words", () => {
    expect(normaliseText("mito-\nchondria   make\r\n\n\n\nATP")).toBe("mitochondria make\n\nATP");
  });
  it("never crosses a page boundary and numbers pages from 1", () => {
    const chunks = chunkPages(["Page one text.", "Page two text."]);
    expect(chunks.map((c) => [c.page, c.text])).toEqual([[1, "Page one text."], [2, "Page two text."]]);
  });
  it("splits long text into passages no longer than CHUNK_MAX", () => {
    const long = Array.from({ length: 400 }, (_, i) => `Sentence number ${i} is about cells.`).join(" ");
    const chunks = chunkPages([long]);
    expect(chunks.length).toBeGreaterThan(5);
    expect(Math.max(...chunks.map((c) => c.text.length))).toBeLessThanOrEqual(CHUNK_MAX);
    expect(chunks.map((c) => c.ordinal)).toEqual(chunks.map((_, i) => i));
  });
  it("hard-wraps a single giant word-blob", () => {
    const chunks = chunkPages(["x".repeat(5000)]);
    expect(chunks.every((c) => c.text.length <= CHUNK_MAX)).toBe(true);
    expect(chunks.map((c) => c.text).join("")).toBe("x".repeat(5000));
  });
  it("handles non-English text", () => {
    const chunks = chunkPages(["细胞是生命的基本单位。线粒体产生能量。", "Η κυτταρική αναπνοή παράγει ATP."]);
    expect(chunks).toHaveLength(2);
    expect(chunks[0].text).toContain("线粒体");
  });
  it("skips empty pages and gives identical text identical hashes", () => {
    const chunks = chunkPages(["", "same", "   ", "same"]);
    expect(chunks.map((c) => c.page)).toEqual([2, 4]);
    expect(chunks[0].contentHash).toBe(chunks[1].contentHash);
  });
  it("notes are unpaged", () => {
    expect(chunkPages(["A note"], { paged: false })[0].page).toBeNull();
  });
});

describe("extractFile", () => {
  it("reads every page of a PDF", async () => {
    const r = await extractFile(fixture("lecture.pdf"), "lecture.pdf");
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    expect(r.pageCount).toBe(3);
    expect(r.chunks.find((c) => c.page === 2)?.text).toContain("Mitochondria produce ATP");
  });
  it("flags a PDF with no text as no_text (scanned)", async () => {
    const r = await extractFile(fixture("scanned.pdf"), "scan.pdf");
    expect(r).toMatchObject({ status: "no_text", pageCount: 2 });
  });
  it("rejects a fake PDF", async () => {
    expect((await extractFile(fixture("fake.pdf"), "fake.pdf")).status).toBe("rejected");
  });
  it("reads a pptx", async () => {
    const r = await extractFile(await makePptx([["Contracts"], ["Offer and acceptance make an agreement."]]), "law.pptx");
    expect(r).toMatchObject({ status: "ready", kind: "pptx", pageCount: 2 });
  });
});
