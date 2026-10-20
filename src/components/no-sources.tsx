"use client";
import Link from "next/link";
import type { ReactNode } from "react";
import { NewNoteButton } from "./new-note-button";
import { useSound } from "./sound-provider";

/**
 * The shared "nothing to work from" empty state of Flashcards, Mindmap, Quizzes and Ask your notes
 * (polish.md P1-1.3): the subject has no notes and no readable files yet.
 */
export function NoSources({ subjectId, title, then, extra, testId }: {
  subjectId: string;
  /** "No flashcards yet" */
  title: string;
  /** Ends "Add a note or a lecture file first, then we can …": "make cards from it". */
  then: string;
  /** A third, plain action (Flashcards: "Add a card"). */
  extra?: ReactNode;
  testId?: string;
}) {
  const { play } = useSound();
  return (
    <section aria-labelledby="no-sources-h" className="sticker relative mx-auto mt-8 flex max-w-lg flex-col items-center gap-3 p-8 text-center" data-testid={testId}>
      <span className="tape" aria-hidden="true" />
      <h2 id="no-sources-h" className="font-display text-3xl">{title}</h2>
      <p className="text-ink-soft">Add a note or a lecture file first, then we can {then}.</p>
      <div className="flex flex-wrap items-start justify-center gap-2">
        <NewNoteButton subjectId={subjectId} label="Write a note" />
        <Link href={`/subjects/${subjectId}#files-h`} className="btn" onClick={() => play("click")}>Upload a file</Link>
        {extra}
      </div>
    </section>
  );
}
