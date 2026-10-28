import {
  AlignmentType, BorderStyle, Document, HeadingLevel, LevelFormat, Packer, Paragraph, TextRun,
  type IParagraphOptions, type IRunOptions,
} from "docx";

/** A Tiptap JSON node, as stored in `notes.content_json`. */
export type TiptapNode = {
  type?: string;
  text?: string;
  attrs?: Record<string, unknown>;
  marks?: { type?: string }[];
  content?: TiptapNode[];
};

const NUMBERED = "studynest-numbered";
const LEVELS = 6;
const HEADINGS = [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3, HeadingLevel.HEADING_4];

type Ctx = { bullet: number; numbered: number; instance: number; quote: boolean; continued?: boolean; nextInstance: () => number };

/** Characters XML 1.0 doesn't allow (Word won't open the file): control characters, U+FFFE/U+FFFF and lone surrogates. */
const NOT_XML = /[^\t\n\r\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu;
const xmlSafe = (text: string) => text.replace(NOT_XML, "");

function runs(nodes: TiptapNode[] | undefined, base: IRunOptions = {}): TextRun[] {
  const out: TextRun[] = [];
  for (const n of nodes ?? []) {
    if (n.type === "hardBreak") { out.push(new TextRun({ ...base, text: "", break: 1 })); continue; }
    if (n.type !== "text" || !n.text) continue;
    const m = new Set((n.marks ?? []).map((x) => x.type));
    out.push(new TextRun({
      ...base,
      text: xmlSafe(n.text),
      bold: m.has("bold") || base.bold,
      italics: m.has("italic") || base.italics,
      strike: m.has("strike") || undefined,
      underline: m.has("underline") ? {} : undefined,
      font: m.has("code") ? "Courier New" : base.font,
    }));
  }
  return out;
}

function blocks(nodes: TiptapNode[] | undefined, ctx: Ctx): Paragraph[] {
  const out: Paragraph[] = [];
  const quote = (o: IParagraphOptions): IParagraphOptions => ctx.quote
    ? { ...o, indent: { left: 567 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: "999999", space: 8 } } }
    : o;
  for (const n of nodes ?? []) {
    switch (n.type) {
      case "paragraph": {
        const level = depth(ctx);
        // Only a list item's first paragraph gets the bullet or number; later ones line up with its text.
        const list = level < 0 ? {}
          : ctx.continued ? { indent: { left: 720 * (level + 1) } }
          : ctx.bullet >= 0 ? { bullet: { level: ctx.bullet } }
          : { numbering: { reference: NUMBERED, level: ctx.numbered, instance: ctx.instance } };
        out.push(new Paragraph(quote({ ...list, children: runs(n.content, ctx.quote ? { italics: true } : {}) })));
        if (level >= 0) ctx = { ...ctx, continued: true };
        break;
      }
      case "heading": {
        const level = Math.min(Math.max(Number(n.attrs?.level) || 2, 1), 4);
        out.push(new Paragraph({ heading: HEADINGS[level - 1], children: runs(n.content) }));
        break;
      }
      case "bulletList":
        for (const item of n.content ?? []) out.push(...blocks(item.content, { ...ctx, bullet: Math.min(depth(ctx) + 1, LEVELS - 1), numbered: -1, continued: false }));
        break;
      case "orderedList": {
        const instance = ctx.nextInstance();
        for (const item of n.content ?? []) out.push(...blocks(item.content, { ...ctx, numbered: Math.min(depth(ctx) + 1, LEVELS - 1), bullet: -1, instance, continued: false }));
        break;
      }
      case "listItem":
        out.push(...blocks(n.content, ctx));
        break;
      case "blockquote":
        out.push(...blocks(n.content, { ...ctx, quote: true }));
        break;
      case "codeBlock": {
        // One paragraph per line keeps the code's line breaks.
        const text = xmlSafe((n.content ?? []).map((t) => t.text ?? "").join(""));
        for (const line of text.split("\n")) out.push(new Paragraph({ children: [new TextRun({ text: line, font: "Courier New" })] }));
        break;
      }
      case "horizontalRule":
        out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "999999", space: 1 } }, children: [] }));
        break;
      default:
        if (n.content) out.push(...blocks(n.content, ctx));
    }
  }
  return out;
}

/** List nesting depth so far (-1 outside any list). */
function depth(ctx: Ctx) {
  return Math.max(ctx.bullet, ctx.numbered);
}

/** Build a Word document from a note's title and Tiptap JSON. Runs in the browser; nothing leaves the device. */
export function noteDocument(rawTitle: string, content: TiptapNode): Document {
  const title = xmlSafe(rawTitle);
  let instance = 0;
  const ctx: Ctx = { bullet: -1, numbered: -1, instance: 0, quote: false, nextInstance: () => ++instance };
  return new Document({
    title: title || "Untitled note",
    creator: "StudyNest",
    numbering: {
      config: [{
        reference: NUMBERED,
        levels: Array.from({ length: LEVELS }, (_, level) => ({
          level,
          format: [LevelFormat.DECIMAL, LevelFormat.LOWER_LETTER, LevelFormat.LOWER_ROMAN][level % 3],
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{ children: [new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun(title || "Untitled note")] }), ...blocks(content.content, ctx)] }],
  });
}

export async function noteDocxBlob(title: string, content: TiptapNode): Promise<Blob> {
  return Packer.toBlob(noteDocument(title, content));
}

/** A safe file name from the note title ("Study notes: Osmosis" -> "Study notes - Osmosis.docx"). */
export function noteFileName(title: string, ext: string): string {
  // Bidi controls go too, so a name can't show reversed ("evil\u202Excod.docx", security review DL-2).
  const trimmed = xmlSafe(title).replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " - ").replace(/\s+/g, " ").replace(/^[\s.-]+|[\s.-]+$/g, "");
  // Cut by characters, not UTF-16 units, so an emoji at the cut isn't split in half.
  const clean = Array.from(trimmed).slice(0, 100).join("").replace(/[\s.-]+$/, "");
  return `${clean || "Untitled note"}.${ext}`;
}
