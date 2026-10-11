"use client";
import { useState, useTransition } from "react";
import { createNote } from "@/server/actions/notes";
import { useSound } from "./sound-provider";
import { Button } from "./ui/button";

export function NewNoteButton({ subjectId, label = "New note" }: { subjectId: string; label?: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { play } = useSound();
  return (
    <div className="flex flex-col items-start gap-2">
      <Button
        variant="primary" disabled={pending}
        onClick={() => start(async () => {
          const res = await createNote(subjectId); // redirects on success
          if (res && !res.ok) { setError(res.error); play("boop"); }
        })}
      >
        {pending ? "Opening…" : `+ ${label}`}
      </Button>
      {error && <p role="alert" className="error-text">{error}</p>}
    </div>
  );
}
