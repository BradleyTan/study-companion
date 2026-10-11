"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { SUBJECT_COLOURS } from "@/lib/subjects";
import { deleteSubject } from "@/server/actions/subjects";
import type { Subject } from "@/server/repo/types";
import { SubjectFormDialog } from "./subject-form";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function SubjectHeader({ subject }: { subject: Subject }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <Link href="/subjects" className="w-fit font-bold underline-offset-4 hover:underline">← All subjects</Link>
      <div className="sticker on-colour flex flex-wrap items-center gap-4 p-5" style={{ background: SUBJECT_COLOURS[subject.colour] }}>
        <span className="text-5xl" role="img" aria-hidden="true">{subject.emoji}</span>
        <h1 className="font-display min-w-0 flex-1 break-words text-4xl">{subject.name}</h1>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
          <Button size="sm" variant="danger" onClick={() => setConfirming(true)}>Delete</Button>
        </div>
      </div>
      <SubjectFormDialog key={`${subject.name}${subject.colour}${subject.emoji}`} open={editing} onClose={() => setEditing(false)} initial={subject} />
      <Dialog open={confirming} onClose={() => setConfirming(false)} title={`Delete ${subject.name}?`}>
        <p>This removes {plural(subject.noteCount, "note")} and {plural(subject.sourceCount, "file")}. This can&apos;t be undone.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirming(false)}>Keep it</Button>
          <Button
            variant="danger" sound="tear" disabled={pending}
            onClick={() => start(async () => { await deleteSubject(subject.id); })}
          >
            {pending ? "Deleting…" : "Delete subject"}
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
