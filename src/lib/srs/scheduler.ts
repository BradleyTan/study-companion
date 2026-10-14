// FSRS scheduling (ts-fsrs). Pure and isomorphic: the server saves with its own clock,
// the review screen uses the same functions to show the interval on each grade button.
// See docs/design/screens/review.md "Scheduling rules".
import { createEmptyCard, fsrs, generatorParameters, type Card, type Grade } from "ts-fsrs";

export type SrsStateNum = 0 | 1 | 2 | 3; // New, Learning, Review, Relearning
export type Rating = 1 | 2 | 3 | 4; // Again, Hard, Good, Easy
export const RATINGS: readonly Rating[] = [1, 2, 3, 4];
export const RATING_LABEL: Record<Rating, string> = { 1: "Again", 2: "Hard", 3: "Good", 4: "Easy" };

/** The schedule stored on a flashcard (and snapshotted on each card_reviews row). */
export type SrsState = {
  state: SrsStateNum;
  dueAt: string;
  stability: number;
  difficulty: number;
  elapsedDays: number;
  scheduledDays: number;
  learningSteps: number;
  reps: number;
  lapses: number;
  lastReviewAt: string | null;
};

/** No fuzz, so the interval shown on a button is exactly the one saved. */
export const scheduler = fsrs(generatorParameters({ request_retention: 0.9, enable_fuzz: false }));

export function newSrs(now: Date): SrsState {
  return fromCard(createEmptyCard(now));
}

export function toCard(s: SrsState): Card {
  return {
    due: new Date(s.dueAt),
    stability: s.stability,
    difficulty: s.difficulty,
    elapsed_days: s.elapsedDays,
    scheduled_days: s.scheduledDays,
    learning_steps: s.learningSteps,
    reps: s.reps,
    lapses: s.lapses,
    state: s.state,
    last_review: s.lastReviewAt ? new Date(s.lastReviewAt) : undefined,
  };
}

export function fromCard(c: Card): SrsState {
  return {
    state: c.state as SrsStateNum,
    dueAt: c.due.toISOString(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsedDays: c.elapsed_days,
    scheduledDays: c.scheduled_days,
    learningSteps: c.learning_steps,
    reps: c.reps,
    lapses: c.lapses,
    lastReviewAt: c.last_review ? c.last_review.toISOString() : null,
  };
}

/** The card's schedule after grading it `rating` at `now`. */
export function gradeCard(s: SrsState, rating: Rating, now: Date): SrsState {
  return fromCard(scheduler.next(toCard(s), now, rating as Grade).card);
}

/** Milliseconds from `now` until the card would be due again, for each grade. */
export function previewIntervals(s: SrsState, now: Date): Record<Rating, number> {
  const out = {} as Record<Rating, number>;
  for (const r of RATINGS) out[r] = Math.max(0, Date.parse(gradeCard(s, r, now).dueAt) - now.getTime());
  return out;
}

/** "Again" or anything due again within this window comes back in the same session. */
export const SAME_SESSION_MS = 20 * 60 * 1000;
