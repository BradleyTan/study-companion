import JSZip from "jszip";

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

export function decodeXml(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
    }
    return ENTITIES[e] ?? m;
  });
}

/** Text of one slide's XML: each <a:p> paragraph becomes a line, runs <a:t> are joined. */
export function slideXmlToText(xml: string): string {
  const paragraphs = xml.split(/<\/a:p>/);
  const lines: string[] = [];
  for (const p of paragraphs) {
    const runs = [...p.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)].map((m) => decodeXml(m[1]));
    const line = runs.join("").trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

export const MAX_SLIDES = 500;

/** Returns one string per slide (in slide order), including speaker notes. */
export async function extractPptx(buf: Uint8Array): Promise<string[]> {
  const zip = await JSZip.loadAsync(buf);
  const slideFiles = zip
    .file(/^ppt\/slides\/slide\d+\.xml$/)
    .sort((a, b) => Number(a.name.match(/(\d+)\.xml$/)![1]) - Number(b.name.match(/(\d+)\.xml$/)![1]))
    .slice(0, MAX_SLIDES);
  const out: string[] = [];
  for (const f of slideFiles) {
    const n = f.name.match(/(\d+)\.xml$/)![1];
    const text = slideXmlToText(await f.async("string"));
    const notesXml = await zip.file(`ppt/notesSlides/notesSlide${n}.xml`)?.async("string");
    const notes = notesXml ? slideXmlToText(notesXml).replace(/^\d+$/m, "").trim() : "";
    out.push(notes ? `${text}\n\nSpeaker notes: ${notes}` : text);
  }
  return out;
}
