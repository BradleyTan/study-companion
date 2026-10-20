"use client";
import { NewNoteButton } from "./new-note-button";
import { Button } from "./ui/button";

/** Scrolls to the subject page's Lecture files section and focuses its file input. */
export function focusUploads() {
  document.getElementById("files-h")?.scrollIntoView({ behavior: "smooth", block: "start" });
  document.getElementById("file-input")?.focus({ preventScroll: true });
}

/**
 * First-run "Start here" sticker on the subject page (subject.md, polish.md P1-1). The page shows it
 * only while the subject has no notes and no files.
 */
export function StartHere({ subjectId }: { subjectId: string }) {
  return (
    <section aria-labelledby="start-h" className="sticker relative flex flex-col gap-3 p-5" data-testid="start-here">
      <span className="tape" aria-hidden="true" />
      <h2 id="start-h" className="font-display text-2xl">Start with your notes</h2>
      <p className="text-ink-soft">Write a note or upload a lecture file. Then StudyNest can turn it into flashcards, a mindmap and quizzes.</p>
      <div className="flex flex-wrap gap-2">
        <NewNoteButton subjectId={subjectId} label="Write a note" />
        <Button onClick={focusUploads}>Upload a file</Button>
      </div>
      <p className="hint">1 Add notes · 2 Make flashcards · 3 Quiz yourself · 4 Start a focus round</p>
    </section>
  );
}
