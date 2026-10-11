import JSZip from "jszip";

export type FileKind = "pdf" | "pptx";
export type DetectResult = { ok: true; kind: FileKind } | { ok: false; error: string };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]; // PK..

function startsWith(buf: Uint8Array, magic: number[]) {
  return magic.every((b, i) => buf[i] === b);
}

/**
 * Decide what a file really is from its bytes, never from its name or the
 * browser-supplied MIME type. Rejects anything that isn't a PDF or a plain
 * (macro-free) PowerPoint .pptx.
 */
export async function detectFileKind(buf: Uint8Array, fileName: string): Promise<DetectResult> {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext !== "pdf" && ext !== "pptx") {
    return { ok: false, error: "Only PDF and PPTX files can be uploaded." };
  }
  if (ext === "pdf") {
    // Some PDFs have a little junk before the header; spec allows it in the first 1 KB.
    const head = buf.subarray(0, 1024);
    for (let i = 0; i + PDF_MAGIC.length <= head.length; i++) {
      if (startsWith(head.subarray(i), PDF_MAGIC)) return { ok: true, kind: "pdf" };
    }
    return { ok: false, error: "That file looks damaged or isn't really a PDF." };
  }
  if (!startsWith(buf, ZIP_MAGIC)) {
    return { ok: false, error: "That file looks damaged or isn't really a PowerPoint file." };
  }
  try {
    const zip = await JSZip.loadAsync(buf);
    const types = await zip.file("[Content_Types].xml")?.async("string");
    if (!types || !zip.file("ppt/presentation.xml")) {
      return { ok: false, error: "That file looks damaged or isn't really a PowerPoint file." };
    }
    if (zip.file(/vbaProject\.bin$/i).length > 0 || types.includes("macroEnabled")) {
      return { ok: false, error: "PowerPoint files with macros can't be uploaded. Save it as a normal .pptx first." };
    }
    return { ok: true, kind: "pptx" };
  } catch {
    return { ok: false, error: "That file looks damaged or isn't really a PowerPoint file." };
  }
}
