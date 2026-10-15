"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { timeAgo } from "@/lib/time";
import { deleteNote } from "@/server/actions/notes";
import type { NoteSummary } from "@/server/repo/types";
import { MakeFlashcardsDialog } from "./flashcards/make-dialog";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RowMenu } from "./ui/row-menu";

/** A note on the subject page, with "⋯" → Make flashcards / Delete (subject.md, Step 2). */
export function NoteRow({ note, subjectId, subjectName }: { note: NoteSummary; subjectId: string; subjectName: string }) {
  const [making, setMaking] = useState(false);
  const [everMade, setEverMade] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [pending, start] = useTransition();
  const title = note.title || "Untitled note";
  return (
    <li className="flex items-stretch gap-2">
      <Link href={`/subjects/${subjectId}/notes/${note.id}`} className="sticker lift block min-w-0 flex-1 p-4">
        <span className="block truncate text-lg font-bold">{title}</span>
        {note.preview && <span className="block truncate text-ink-soft">{note.preview}</span>}
        <span className="hint">Edited {timeAgo(note.updatedAt)}</span>
      </Link>
      <RowMenu
        className="self-center"
        label={`More for ${title}`}
        items={[
          { label: "Make flashcards", onSelect: () => { setEverMade(true); setMaking(true); } },
          { label: "Delete", onSelect: () => setConfirm(true), danger: true },
        ]}
      />
      {everMade && (
        <MakeFlashcardsDialog subjectId={subjectId} subjectName={subjectName} open={making} onClose={() => setMaking(false)} preset={{ type: "note", id: note.id }} />
      )}
      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Delete this note?">
        <p>&ldquo;{title}&rdquo; will be gone for good. Flashcards made from it stay in your deck, with their quotes.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>Keep it</Button>
          <Button variant="danger" sound="tear" disabled={pending} onClick={() => start(async () => { await deleteNote(note.id); })}>Delete note</Button>
        </div>
      </Dialog>
    </li>
  );
}
