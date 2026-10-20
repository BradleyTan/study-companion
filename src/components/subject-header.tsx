"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { SUBJECT_COLOURS } from "@/lib/subjects";
import { deleteSubject } from "@/server/actions/subjects";
import type { Subject } from "@/server/repo/types";
import { SubjectFormDialog } from "./subject-form";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { RowMenu } from "./ui/row-menu";
import { useSound } from "./sound-provider";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function SubjectHeader({ subject }: { subject: Subject }) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const { play } = useSound();
  return (
    <div className="flex flex-col gap-3">
      <Link href="/subjects" className="w-fit inline-flex min-h-11 items-center font-bold underline-offset-4 hover:underline" onClick={() => play("click")}>← All subjects</Link>
      <div className="sticker on-colour flex flex-wrap items-center gap-3 p-4 sm:gap-4 sm:p-5" style={{ background: SUBJECT_COLOURS[subject.colour] }}>
        <span className="text-4xl sm:text-5xl" role="img" aria-hidden="true">{subject.emoji}</span>
        {/* overflow-wrap:anywhere only splits a single word wider than the row; short words never break. */}
        <h1 className="font-display min-w-0 flex-1 text-3xl hyphens-auto [overflow-wrap:anywhere] sm:text-4xl" data-testid="subject-title">{subject.name}</h1>
        {/* Phones: one "⋯" menu keeps the title wide and the red Delete away from the thumb (polish.md P1-3). */}
        <RowMenu
          className="sm:hidden"
          label={`More for ${subject.name}`}
          items={[
            { label: "Edit subject", onSelect: () => setEditing(true) },
            { label: "Delete subject", onSelect: () => setConfirming(true), danger: true },
          ]}
        />
        <div className="hidden gap-2 sm:flex">
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
