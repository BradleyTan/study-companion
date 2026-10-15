// Writes long-lecture.pdf: a 12-page text PDF for the "long files" e2e test.
// Each page has ~2,500 characters, so about five pages fit one flashcard set (14,000 chars).
// Run: node e2e/fixtures/make-long-lecture.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TOPICS = ["enzymes", "the cell membrane", "mitochondria", "ribosomes", "the nucleus", "chloroplasts",
  "osmosis", "diffusion", "active transport", "DNA replication", "protein synthesis", "cell division"];
const FACTS = [
  "is a key idea that students should be able to explain in their own words",
  "links closely to how cells stay alive and keep their inside conditions steady",
  "was first described by scientists using light microscopes and later electron microscopes",
  "depends on the temperature and the pH of the surroundings inside the organism",
  "can be measured in the laboratory with simple experiments and careful observation",
  "often appears in exam questions that ask for a clear definition and an example",
];

const pages = TOPICS.map((topic, p) => {
  const lines = [`Lecture 5, page ${p + 1}: ${topic}`];
  for (let i = 0; lines.join(" ").length < 2400; i++) {
    lines.push(`Point ${i + 1}: ${topic} ${FACTS[(i + p) % FACTS.length]}.`);
  }
  return lines;
});

const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
const objects = [];
const add = (body) => { objects.push(body); return objects.length; };
const font = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
const pagesId = objects.length + 1 + pages.length * 2; // reserved below
const kids = [];
for (const lines of pages) {
  const content = `BT\n/F1 9 Tf\n40 760 Td\n12 TL\n${lines.map((l) => `(${esc(l)}) Tj T*`).join("\n")}\nET`;
  const c = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
  kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${c} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`));
}
add(`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`);
const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);

let out = "%PDF-1.4\n";
const offsets = [];
objects.forEach((body, i) => { offsets.push(Buffer.byteLength(out)); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
const xref = Buffer.byteLength(out);
out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
writeFileSync(fileURLToPath(new URL("./long-lecture.pdf", import.meta.url)), out, "latin1");
