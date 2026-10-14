// Small text helpers shared by validation, the fake generator and passage matching.

export const collapse = (s: string) => s.replace(/\s+/g, " ").trim();

/** Cut to `max` characters at a word boundary when possible. */
export function clip(s: string, max: number): string {
  const t = collapse(s);
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
}

export function sentences(text: string): string[] {
  return (collapse(text).match(/[^.!?]+[.!?]+["')\]]*|[^.!?]+$/g) ?? []).map((s) => s.trim()).filter(Boolean);
}

const STOP = new Set("the a an of and or to in on for is are was were be by with as at that this it its from into than then".split(" "));
export function words(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w));
}

/** How many distinct content words `a` shares with `b`. */
export function overlap(a: string, b: string): number {
  const bw = new Set(words(b));
  return new Set(words(a).filter((w) => bw.has(w))).size;
}

/** Case- and whitespace-insensitive "does `hay` contain `needle`". */
export function containsLoose(hay: string, needle: string): boolean {
  const n = collapse(needle).toLowerCase();
  return n.length > 0 && collapse(hay).toLowerCase().includes(n);
}
