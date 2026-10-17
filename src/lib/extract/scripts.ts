// Unicode superscripts and subscripts, for text drawn as small raised or lowered characters
// (Word-style PDFs, PowerPoint runs with a baseline): "10" + raised "8" must stay 10⁸, not 108.

export const SUP: Record<string, string> = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "−": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", n: "ⁿ", i: "ⁱ",
};
export const SUB: Record<string, string> = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "−": "₋", "=": "₌", "(": "₍", ")": "₎",
};

/** The run in Unicode super/subscript characters, or unchanged when one of them has none (e.g. "st" in 1st). */
export function toScript(s: string, map: Record<string, string>): string {
  const chars = [...s];
  return chars.length > 0 && chars.every((c) => map[c]) ? chars.map((c) => map[c]).join("") : s;
}
