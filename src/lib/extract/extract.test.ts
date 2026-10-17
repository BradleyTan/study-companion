import { readFileSync } from "node:fs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { CHUNK_MAX, chunkPages, normaliseText, planChunkSync, sha256 } from "./chunk";
import { detectFileKind } from "./detect";
import { extractFile } from "./index";
import { pageText } from "./pdf";
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
  it("keeps superscript/subscript runs and line breaks (10⁸, CO₂, Ca²⁺)", () => {
    const r = (t: string, baseline?: number) => `<a:r><a:rPr lang="en-GB"${baseline ? ` baseline="${baseline}"` : ""}/><a:t>${t}</a:t></a:r>`;
    const xml = `<a:p>${r("c = 3.0 × 10")}${r("8", 30000)}${r(" m/s; CO")}${r("2", -25000)}${r(" and Ca")}${r("2+", 30000)}<a:br/>${r("the 1")}${r("st", 30000)}${r("line")}</a:p>`;
    expect(slideXmlToText(xml)).toBe("c = 3.0 × 10⁸ m/s; CO₂ and Ca²⁺ the 1stline");
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
  it("keeps the hyphen of terms broken across lines (α-helix, 3-phosphate, BRCA1-linked)", () => {
    expect(normaliseText("Mito-\nchondria and (cyto-\nplasm)")).toBe("Mitochondria and (cytoplasm)");
    // Known limitation: a real hyphen before a lower-case line start is lost ("Gram-negative").
    expect(normaliseText("a Gram-\nnegative cell")).toBe("a Gramnegative cell");
    expect(normaliseText("the α-\nhelix and β-\nsheets")).toBe("the α-helix and β-sheets");
    expect(normaliseText("glyceraldehyde 3-\nphosphate")).toBe("glyceraldehyde 3-phosphate");
    expect(normaliseText("BRCA1-\nlinked")).toBe("BRCA1-linked");
  });
  it("re-joins hyphens in linear time on long runs without spaces", () => {
    const t = performance.now();
    normaliseText(`${"a".repeat(80_000)}-\nb ${"x-".repeat(40_000)}`);
    expect(performance.now() - t).toBeLessThan(500);
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
  it("keeps science notation exactly (science-lecture.pdf)", async () => {
    const r = await extractFile(fixture("science-lecture.pdf"), "science.pdf");
    expect(r.status).toBe("ready");
    if (r.status !== "ready") return;
    expect(r.pageCount).toBe(3);
    const page = (n: number) => r.chunks.filter((c) => c.page === n).map((c) => c.text.replace(/\s+/g, " ")).join(" ");
    for (const s of ["Escherichia coli (E. coli)", "Homo sapiens", "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂", "SO₄²⁻", "charge of −2", "Ca²⁺", "H₂CO₃ ⇌ H⁺ + HCO₃⁻", "BRCA1", "p53", "Na⁺/K⁺-ATPase", "104.5°"]) {
      expect(page(1), s).toContain(s);
    }
    for (const s of ["ΔG = ΔH − TΔS", "E = mc²", "pH = −log[H⁺]", "7.35–7.45", "α-helix", "β-sheets", "−70 mV", "37 °C", "5.5 mmol·L⁻¹", "0.012 s⁻¹"]) {
      expect(page(2), s).toContain(s);
    }
    // µ (micro sign) comes out as μ (Greek mu): same glyph; grounding treats them as equal (NFKC).
    expect(page(2)).toMatch(/10–30 [µμ]m/);
    // Word-style sub/superscripts (small raised/lowered digits) and an "fi" ligature.
    for (const s of ["C₆H₁₂O₆ + 6O₂ → 6CO₂ + 6H₂O", "(Ca²⁺)", "3.0 × 10⁸ m/s", "efficiency", "−273.15 °C"]) {
      expect(page(3), s).toContain(s);
    }
    expect(page(3)).not.toContain("108 m/s");
  });
  it("turns small raised or lowered runs into Unicode super/subscripts, and leaves others alone", () => {
    const item = (str: string, size: number, y: number, hasEOL = false) => ({ str, transform: [size, 0, 0, size, 0, y], hasEOL });
    expect(pageText([item("x", 11, 100), item("2", 8, 104), item(" + 10", 11, 100), item("-3", 8, 104.5)])).toBe("x² + 10⁻³");
    expect(pageText([item("CO", 11, 100), item("2", 8, 97)])).toBe("CO₂");
    // "1st": no superscript "s", so kept as written; a footnote "1" becomes ¹ (still the same number).
    expect(pageText([item("the 1", 11, 100), item("st", 8, 104)])).toBe("the 1st");
    // Smaller text on the same baseline (a label) and a new line are not scripts.
    expect(pageText([item("Fig 2", 11, 100), item("12", 8, 100)])).toBe("Fig 212");
    expect(pageText([item("end", 11, 100, true), item("12", 8, 90)])).toBe("end\n12");
    // Rotated text and marked-content items are passed through.
    expect(pageText([{ str: "a" }, { transform: [0, 1, -1, 0, 0, 0] }, { str: "b", transform: [0, 11, -11, 0, 0, 0] }])).toBe("ab");
  });
  it("reads a pptx", async () => {
    const r = await extractFile(await makePptx([["Contracts"], ["Offer and acceptance make an agreement."]]), "law.pptx");
    expect(r).toMatchObject({ status: "ready", kind: "pptx", pageCount: 2 });
  });
});

describe("planChunkSync", () => {
  const stored = (id: string, ordinal: number, text: string) => ({ id, ordinal, page: null, contentHash: sha256(text) });
  const fresh = (ordinal: number, text: string) => ({ ordinal, page: null, text, contentHash: sha256(text) });

  it("keeps unchanged passages (with new positions), inserts new ones, removes gone ones", () => {
    const plan = planChunkSync(
      [stored("a", 0, "Intro"), stored("b", 1, "Cells"), stored("c", 2, "Old ending")],
      [fresh(0, "New first paragraph"), fresh(1, "Intro"), fresh(2, "Cells")],
    );
    expect(plan.keep).toEqual([{ id: "a", ordinal: 1 }, { id: "b", ordinal: 2 }]);
    expect(plan.insert.map((c) => c.text)).toEqual(["New first paragraph"]);
    expect(plan.remove).toEqual(["c"]);
  });

  it("handles repeated text one-to-one and does nothing when nothing changed", () => {
    const plan = planChunkSync([stored("a", 0, "Same"), stored("b", 1, "Same")], [fresh(0, "Same"), fresh(1, "Same"), fresh(2, "Same")]);
    expect(plan.keep.map((k) => k.id)).toEqual(["a", "b"]);
    expect(plan.insert).toHaveLength(1);
    expect(plan.remove).toEqual([]);
    const same = planChunkSync([stored("a", 0, "x")], [fresh(0, "x")]);
    expect(same).toEqual({ keep: [{ id: "a", ordinal: 0 }], insert: [], remove: [] });
  });
});
