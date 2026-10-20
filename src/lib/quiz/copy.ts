// Best-score copy for the subject page Quizzes tile and the quiz shelf (polish.md P2-12). Pure.

export type BestScore = { score: number; total: number };

/**
 * "Best 3/9" from one right answer up. A best of 0 reads "Tried once · have another go"
 * ("Tried 2 times · …" after more tries), never "Best 0/9". `label` is the accessible name.
 */
export function bestScoreCopy(best: BestScore, tries: number): { text: string; label: string } {
  if (best.score > 0) return { text: `Best ${best.score}/${best.total}`, label: `Best score ${best.score} out of ${best.total}` };
  const text = `Tried ${tries <= 1 ? "once" : `${tries} times`} · have another go`;
  return { text, label: text };
}
