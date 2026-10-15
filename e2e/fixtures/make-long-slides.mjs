// Writes long-slides.pptx: a 12-slide deck for the "long files" e2e test (PPTX says "slides").
// Each slide has ~2,500 characters, so about five slides fit one flashcard set (14,000 chars).
// Minimal OOXML: only what src/lib/extract (detect + pptx) reads. Run: node e2e/fixtures/make-long-slides.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const TOPICS = ["supply", "demand", "elasticity", "market equilibrium", "price controls", "taxes",
  "consumer surplus", "producer surplus", "monopoly", "oligopoly", "public goods", "externalities"];
const FACTS = [
  "is a key idea that students should be able to explain in their own words",
  "links closely to how markets reach a price that buyers and sellers accept",
  "was first described by economists studying trade and later tested with data",
  "depends on the choices of households and firms and the rules set by government",
  "can be shown on a simple diagram with a clear label on each axis",
  "often appears in exam questions that ask for a clear definition and an example",
];
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const zip = new JSZip();
const slides = TOPICS.map((topic, p) => {
  const lines = [`Economics week 3, slide ${p + 1}: ${topic}`];
  for (let i = 0; lines.join(" ").length < 2400; i++) lines.push(`Point ${i + 1}: ${topic} ${FACTS[(i + p) % FACTS.length]}.`);
  return lines;
});
zip.file("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>${slides.map((_, i) => `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`).join("")}</Types>`);
zip.file("ppt/presentation.xml", `<?xml version="1.0" encoding="UTF-8"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
slides.forEach((lines, i) => {
  zip.file(`ppt/slides/slide${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8"?><p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:sp><p:txBody>${lines.map((l) => `<a:p><a:r><a:t>${esc(l)}</a:t></a:r></a:p>`).join("")}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`);
});
const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
writeFileSync(fileURLToPath(new URL("./long-slides.pptx", import.meta.url)), buf);
