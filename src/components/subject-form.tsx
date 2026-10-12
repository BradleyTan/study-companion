"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { COLOUR_NAMES, SUBJECT_COLOURS, SUBJECT_EMOJIS, type SubjectColour } from "@/lib/subjects";
import { createSubject, updateSubject } from "@/server/actions/subjects";
import { useSound } from "./sound-provider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

type Initial = { id?: string; name: string; colour: SubjectColour; emoji: string };

export function SubjectFormDialog({ open, onClose, initial }: { open: boolean; onClose: () => void; initial?: Initial }) {
  const editing = Boolean(initial?.id);
  const [name, setName] = useState(initial?.name ?? "");
  const [colour, setColour] = useState<SubjectColour>(initial?.colour ?? "sky");
  const [emoji, setEmoji] = useState(initial?.emoji ?? SUBJECT_EMOJIS[0]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { play } = useSound();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const input = { name, colour, emoji };
      const res = editing ? await updateSubject(initial!.id!, input) : await createSubject(input);
      if (!res.ok) {
        setError(res.error);
        play("boop");
        return;
      }
      play("pop");
      setError(null);
      onClose();
      if (!editing) setName("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onClose={onClose} title={editing ? "Edit subject" : "New subject"}>
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div aria-hidden="true" className="sticker flex items-center gap-3 p-3 on-colour" style={{ background: SUBJECT_COLOURS[colour] }}>
          <span className="text-3xl">{emoji}</span>
          <span className="truncate text-lg font-bold">{name.trim() || "Subject name"}</span>
        </div>
        <div className="field">
          <label htmlFor="subject-name">Name</label>
          <input
            id="subject-name" className="input" value={name} maxLength={60} required autoFocus
            placeholder="e.g. Biology 101" onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(error)} aria-describedby={error ? "subject-error" : undefined}
          />
        </div>
        <fieldset className="field">
          <legend className="label mb-1">Colour</legend>
          <div className="flex flex-wrap gap-2">
            {COLOUR_NAMES.map((c) => (
              <label key={c} className="cursor-pointer">
                <input type="radio" name="colour" value={c} checked={colour === c} onChange={() => { setColour(c); play("click"); }} className="peer sr-only" />
                <span
                  className="block h-10 w-10 rounded-full border-[2.5px] border-ink peer-checked:shadow-[0_0_0_3px_var(--card),0_0_0_6px_var(--ink)] peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-[var(--focus)] peer-focus-visible:outline-offset-4"
                  style={{ background: SUBJECT_COLOURS[c] }}
                />
                <span className="sr-only">{c}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="field">
          <legend className="label mb-1">Icon</legend>
          <div className="grid grid-cols-8 gap-1">
            {SUBJECT_EMOJIS.map((em) => (
              <label key={em} className="cursor-pointer">
                <input type="radio" name="emoji" value={em} checked={emoji === em} onChange={() => { setEmoji(em); play("click"); }} className="peer sr-only" />
                <span className="flex aspect-square items-center justify-center rounded-md border-2 border-transparent text-2xl peer-checked:border-ink peer-checked:bg-highlight peer-focus-visible:outline peer-focus-visible:outline-3 peer-focus-visible:outline-[var(--focus)]">
                  {em}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {error && <p id="subject-error" role="alert" className="error-text">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={pending} sound={null}>
            {pending ? "Saving…" : editing ? "Save changes" : "Create subject"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
