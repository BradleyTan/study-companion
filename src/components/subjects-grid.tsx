"use client";
import Link from "next/link";
import { useState } from "react";
import { SUBJECT_COLOURS } from "@/lib/subjects";
import type { Subject } from "@/server/repo/types";
import { useSound } from "./sound-provider";
import { SubjectFormDialog } from "./subject-form";
import { Button } from "./ui/button";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

export function SubjectsGrid({ subjects, due = {} }: { subjects: Subject[]; due?: Record<string, number> }) {
  const [open, setOpen] = useState(false);
  const { play } = useSound();

  if (subjects.length === 0) {
    return (
      <>
        <div className="sticker relative mx-auto mt-8 flex max-w-lg flex-col items-center gap-3 p-8 text-center">
          <span className="tape" aria-hidden="true" />
          <p className="font-display text-3xl">Your notebook is empty</p>
          <p className="text-ink-soft">Make a subject for each course, like Biology or Contract Law. Your notes and lecture files go inside.</p>
          <Button variant="primary" onClick={() => setOpen(true)}>Create your first subject</Button>
        </div>
        <SubjectFormDialog open={open} onClose={() => setOpen(false)} />
      </>
    );
  }

  return (
    <>
      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3" role="list">
        {subjects.map((s, i) => (
          <li key={s.id} className="pop-in" style={{ ["--r" as string]: i % 2 ? "1deg" : "-1deg" }}>
            <Link
              href={`/subjects/${s.id}`}
              onClick={() => play("flip")}
              className="sticker lift on-colour flex min-h-36 flex-col justify-between gap-3 p-5"
              style={{ background: SUBJECT_COLOURS[s.colour], rotate: "var(--r)" }}
            >
              <span className="text-4xl" role="img" aria-hidden="true">{s.emoji}</span>
              <span>
                <span className="block text-xl font-bold [overflow-wrap:anywhere]">{s.name}</span>
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-bold opacity-80">{plural(s.noteCount, "note")} · {plural(s.sourceCount, "file")}</span>
                  {!!due[s.id] && <span className="chip chip-due">{due[s.id]} due</span>}
                </span>
              </span>
            </Link>
          </li>
        ))}
        <li>
          <button
            type="button"
            onClick={() => { play("click"); setOpen(true); }}
            className="flex h-full min-h-36 w-full items-center justify-center rounded-lg border-[2.5px] border-dashed border-ink bg-card/60 p-5 text-lg font-bold hover:bg-highlight hover:text-[var(--on-colour)]"
          >
            + New subject
          </button>
        </li>
      </ul>
      <SubjectFormDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
