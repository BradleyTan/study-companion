// The tiny Markdown subset of a stored chat answer (chat.md "Length"): paragraphs separated by a
// blank line, "- " and "1. " list items, **bold** and [n] citations. Parsed into plain data the
// screen renders as React text nodes, so nothing in an answer can ever become HTML.

export type Inline = { t: "text"; v: string } | { t: "bold"; v: string } | { t: "cite"; n: number };
export type Block = { t: "p"; inlines: Inline[] } | { t: "ul" | "ol"; items: Inline[][] };

const INLINE = /\*\*(.+?)\*\*|\s*\[(\d{1,2})\]/g;

export function parseInline(s: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of s.matchAll(INLINE)) {
    if (m.index > last) out.push({ t: "text", v: s.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: "bold", v: m[1] });
    else {
      // A space before the chip is kept as text so it doesn't stick to the full stop.
      if (/^\s/.test(m[0])) out.push({ t: "text", v: " " });
      out.push({ t: "cite", n: Number(m[2]) });
    }
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: "text", v: s.slice(last) });
  // Neighbouring text pieces merged.
  return out.reduce<Inline[]>((acc, x) => {
    const prev = acc[acc.length - 1];
    if (x.t === "text" && prev?.t === "text") prev.v += x.v;
    else acc.push({ ...x });
    return acc;
  }, []);
}

export function parseContent(content: string): Block[] {
  const blocks: Block[] = [];
  for (const chunk of content.replace(/\r\n?/g, "\n").split(/\n{2,}/)) {
    const lines = chunk.split("\n").map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const ul = lines.every((l) => /^- /.test(l));
    const ol = !ul && lines.every((l) => /^\d{1,2}\. /.test(l));
    if (ul || ol) blocks.push({ t: ul ? "ul" : "ol", items: lines.map((l) => parseInline(l.replace(/^(?:- |\d{1,2}\. )/, ""))) });
    else blocks.push({ t: "p", inlines: parseInline(lines.join(" ")) });
  }
  return blocks;
}

/** The citation numbers used in a text, in order. */
export function citeNumbers(content: string): number[] {
  return [...new Set([...content.matchAll(/\[(\d{1,2})\]/g)].map((m) => Number(m[1])))];
}

/** Text to read aloud or copy: no citation numbers, no bold marks; list items on their own lines. */
export function plainText(content: string): string {
  return content
    .replace(/\s*\[\d{1,2}\]/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^- /gm, "• ")
    .replace(/[ \t]+/g, " ")
    .trim();
}
