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
