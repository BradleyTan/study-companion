export const MAX_PDF_PAGES = 500;

/** Returns one string per page. unpdf bundles a serverless build of PDF.js (no native deps). */
export async function extractPdf(buf: Uint8Array): Promise<string[]> {
  const { getDocumentProxy, extractText } = await import("unpdf");
  // PDF.js may detach the buffer it is given, so pass a copy.
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  if (pdf.numPages > MAX_PDF_PAGES) {
    throw new ExtractLimitError(`That PDF has ${pdf.numPages} pages. The limit is ${MAX_PDF_PAGES}.`);
  }
  const { text } = await extractText(pdf, { mergePages: false });
  return text;
}

export class ExtractLimitError extends Error {}
