/**
 * Finds `needle` in `hay` ignoring case and differences in whitespace, and returns the
 * range in the original `hay` (end exclusive). Used to mark a quoted passage in a note.
 */
export function findLoose(hay: string, needle: string): { start: number; end: number } | null {
  const map: number[] = [];
  let norm = "";
  let lastSpace = true;
  for (let i = 0; i < hay.length; i++) {
    const ch = hay[i];
    if (/\s/.test(ch)) {
      if (lastSpace) continue;
      norm += " ";
      map.push(i);
      lastSpace = true;
    } else {
      norm += ch.toLowerCase();
      map.push(i);
      lastSpace = false;
    }
  }
  const n = needle.replace(/\s+/g, " ").trim().toLowerCase();
  if (!n) return null;
  const at = norm.indexOf(n);
  if (at === -1) return null;
  return { start: map[at], end: map[at + n.length - 1] + 1 };
}

/**
 * Finds a stored passage in the current text. A note's passage starts with the note title
 * (which isn't part of the editor text), so this matches paragraph by paragraph and returns
 * the span from the first to the last paragraph found, in order.
 */
export function findPassage(hay: string, passage: string): { start: number; end: number } | null {
  const whole = findLoose(hay, passage);
  if (whole) return whole;
  const all = passage.split(/\n+/).map((p) => p.trim()).filter(Boolean);
  // Short lines (a title, a heading) match too easily elsewhere; skip them when there's more.
  const long = all.filter((p) => p.length >= 20);
  const paras = long.length ? long : all;
  let first: { start: number; end: number } | null = null;
  let last: { start: number; end: number } | null = null;
  for (const p of paras) {
    const from: number = last ? last.end : 0;
    const hit = findLoose(hay.slice(from), p);
    if (!hit) continue;
    const abs: { start: number; end: number } = { start: hit.start + from, end: hit.end + from };
    first ??= abs;
    last = abs;
  }
  return first && last ? { start: first.start, end: last.end } : null;
}
