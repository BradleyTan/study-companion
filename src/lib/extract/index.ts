import "server-only";
import { chunkPages, type Chunk } from "./chunk";
import { detectFileKind, type FileKind } from "./detect";
import { ExtractLimitError, extractPdf } from "./pdf";
import { extractPptx } from "./pptx";

export type ExtractResult =
  | { status: "ready"; kind: FileKind; pageCount: number; chunks: Chunk[] }
  | { status: "no_text"; kind: FileKind; pageCount: number; chunks: [] }
  | { status: "rejected"; error: string }
  | { status: "failed"; kind: FileKind; error: string };

/** Minimum characters of real text before we call a file "readable". */
const MIN_TEXT = 20;

export async function extractFile(buf: Uint8Array, fileName: string): Promise<ExtractResult> {
  const detected = await detectFileKind(buf, fileName);
  if (!detected.ok) return { status: "rejected", error: detected.error };
  const kind = detected.kind;
  try {
    const pages = kind === "pdf" ? await extractPdf(buf) : await extractPptx(buf);
    const chunks = chunkPages(pages);
    const total = chunks.reduce((n, c) => n + c.text.length, 0);
    if (total < MIN_TEXT) return { status: "no_text", kind, pageCount: pages.length, chunks: [] };
    return { status: "ready", kind, pageCount: pages.length, chunks };
  } catch (e) {
    if (e instanceof ExtractLimitError) return { status: "failed", kind, error: e.message };
    return { status: "failed", kind, error: "We couldn't read the text in that file." };
  }
}

export { chunkPages };
