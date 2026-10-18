// A sentence that copies a run of its passage word for word but puts a different word from the
// same passage in one place ("Efferent neurons carry impulses towards the CNS" when the passage
// says "Afferent neurons carry impulses towards…"; "Mitosis produces four haploid gametes" when it
// says "meiosis produces four…"; "work best at 45 °C" when it says "work best at 37 °C … above
// 45 °C"). isGrounded can't see these: every word and number is in the passage. QA step 3.
import { canonical, stem, STOP } from "./text";

/** Pronouns and other words that stand in for a term ("They have a double membrane"). */
const STAND_IN = new Set("they them their these those he she his her we you our which who whom whose there here such each both also one ones".split(" "));
const raw = (s: string) => canonical(s).match(/[\p{L}\p{N}]+/gu) ?? [];
/**
 * For each word, whether a clause ends right after it (. ; : ! ? but not a decimal point): context
 * never runs across one ("…may burst; in a hypertonic solution…" is two clauses).
 */
function breaksAfter(s: string): boolean[] {
  const c = canonical(s);
  const out: boolean[] = [];
  const re = /[\p{L}\p{N}]+/gu;
  let m: RegExpExecArray | null;
  let prevEnd = -1;
  while ((m = re.exec(c))) {
    if (prevEnd >= 0) out[out.length - 1] = /[;:!?]|\.(?!\d)/.test(c.slice(prevEnd, m.index));
    out.push(false);
    prevEnd = m.index + m[0].length;
  }
  return out;
}
const tokens = (list: string[]) => list.map((t) => (/\d/.test(t) ? t : stem(t)));
/** A term or number, not a function word (checked on the word as written, before stemming). */
const content = (t: string) => /\d/.test(t) || (t.length > 2 && !STOP.has(t) && !STAND_IN.has(t));

/** Words of context (both sides together) a swap needs before it counts. */
const CONTEXT = 3;
/** A word found this close to the other one's place is words left out, added or moved, not a swap. */
const SHIFT = 4;
const near = (list: string[], at: number, word: string) => list.slice(Math.max(0, at - SHIFT), at + SHIFT + 1).includes(word);

function containsRun(hay: string[], run: string[]): boolean {
  outer: for (let j = 0; j + run.length <= hay.length; j++) {
    for (let k = 0; k < run.length; k++) if (hay[j + k] !== run[k]) continue outer;
    return true;
  }
  return false;
}

/**
 * True when `claim` swaps one word of a verbatim passage run for another word of the passage:
 * at least 3 matching words around the swap, the new word is a content word or number that the
 * passage uses elsewhere (but not within 4 words of that place, which would be words left out,
 * added or moved), and the claim's run with that word is nowhere in the passage.
 */
export function contradictsPassage(claim: string, passageText: string): boolean {
  return swapIn(claim, passageText) !== null;
}

/** The swapped pair (claim's word, passage's word), for tests; null when there is none. */
export function swapIn(claim: string, passageText: string): [string, string] | null {
  const sRaw = raw(claim);
  const pRaw = raw(passageText);
  const s = tokens(sRaw);
  const p = tokens(pRaw);
  const stop = breaksAfter(passageText);
  if (s.length < CONTEXT + 1 || !p.length) return null;
  // "3′ to 5′" when the passage only says "5′ to 3′" (directions, ranges, "from dilute to concentrated").
  for (let t = 1; t + 1 < s.length; t++) {
    if (sRaw[t] !== "to" || s[t - 1] === s[t + 1]) continue;
    const run = [s[t - 1], "to", s[t + 1]];
    if (containsRun(p, [run[2], "to", run[0]]) && !containsRun(p, run)) return [`${sRaw[t - 1]} to ${sRaw[t + 1]}`, `${sRaw[t + 1]} to ${sRaw[t - 1]}`];
  }
  const vocab = new Set(p);
  for (let i = 0; i < s.length; i++) {
    if (!content(sRaw[i]) || !vocab.has(s[i])) continue;
    for (let j = 0; j < p.length; j++) {
      if (p[j] === s[i] || !content(pRaw[j])) continue;
      let k = 0;
      while (i - k - 1 >= 0 && j - k - 1 >= 0 && !stop[j - k - 1] && s[i - k - 1] === p[j - k - 1]) k++;
      let m = 0;
      while (i + m + 1 < s.length && j + m + 1 < p.length && !stop[j + m] && s[i + m + 1] === p[j + m + 1]) m++;
      if (k + m < CONTEXT) continue;
      // Short context on both sides must end at the claim's edge, a clause break or a word added
      // or left out; ending at a second different word means another clause, not a swap.
      if (k < CONTEXT && m < CONTEXT) {
        const a = i - k - 1;
        const b = j - k - 1;
        const leftEnds = a < 0 || b < 0 || stop[b] || s[a - 1] === p[b] || s[a] === p[b - 1];
        const c = i + m + 1;
        const d = j + m + 1;
        const rightEnds = c >= s.length || d >= p.length || stop[d - 1] || s[c + 1] === p[d] || s[c] === p[d + 1];
        if (!leftEnds || !rightEnds) continue;
      }
      if (near(p, j, s[i]) || near(s, i, p[j])) continue;
      if (!containsRun(p, s.slice(i - k, i + m + 1))) return [sRaw[i], pRaw[j]];
    }
  }
  return null;
}
