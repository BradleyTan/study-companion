import { SUB, SUP, toScript } from "./scripts";

export const MAX_PDF_PAGES = 500;

/** Returns one string per page. unpdf bundles a serverless build of PDF.js (no native deps). */
export async function extractPdf(buf: Uint8Array): Promise<string[]> {
  const { getDocumentProxy } = await import("unpdf");
  // PDF.js may detach the buffer it is given, so pass a copy.
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new ExtractLimitError(`That PDF has ${pdf.numPages} pages. The limit is ${MAX_PDF_PAGES}.`);
  }
  // In parallel, as unpdf's extractText does.
  return Promise.all(Array.from({ length: pdf.numPages }, async (_, i) => {
    const page = await pdf.getPage(i + 1);
    const content = await page.getTextContent();
    page.cleanup();
    return pageText(content.items as TextItem[]);
  }));
}

export class ExtractLimitError extends Error {}

/** The part of a PDF.js text item we read (marked-content items have no `str`). */
export type TextItem = { str?: string; transform?: number[]; hasEOL?: boolean };

/**
 * One page's text, as PDF.js items joined (the same as unpdf's extractText), except that
 * superscripts and subscripts drawn the way Word does it (ordinary digits in a smaller font,
 * raised or lowered) become Unicode ones: "10" + raised "8" is "10⁸", not "108" (a wrong
 * number), and "Ca" + raised "2+" is "Ca²⁺". Runs with characters that have no Unicode
 * super/subscript (e.g. "st" in 1st) are kept as they are.
 */
export function pageText(items: TextItem[]): string {
  let out = "";
  let base: { y: number; size: number } | null = null;
  for (const it of items) {
    if (it.str == null) continue;
    let s = it.str;
    const t = it.transform;
    // Only upright text: rotated or skewed items have no meaningful baseline to compare.
    const upright = !!t && t.length >= 6 && t[1] === 0 && t[2] === 0 && t[3] > 0;
    if (upright && s.trim()) {
      const size = t[3];
      const y = t[5];
      if (base && size < base.size * 0.9 && Math.abs(y - base.y) < base.size) {
        const dy = y - base.y;
        const map = dy > base.size * 0.15 ? SUP : dy < -base.size * 0.08 ? SUB : null;
        const converted = map ? toScript(s.trim(), map) : s;
        if (converted !== s.trim()) s = converted;
      } else {
        base = { y, size };
      }
    }
    out += s + (it.hasEOL ? "\n" : "");
    if (it.hasEOL) base = null;
  }
  return out;
}
