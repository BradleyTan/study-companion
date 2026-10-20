"use client";
import { useId, useState } from "react";
import { cleanTopic, TOPIC_MAX } from "@/lib/quiz/weak";
import { addWeakTopic, type AddedTopic } from "@/server/actions/weak-topics";
import { useSound } from "../sound-provider";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";

/** "+ Add weak topic" sheet (polish.md): one Topic field, Add / Cancel, inline errors. */
export function AddTopicDialog({ subjectId, open, onClose, onAdded }: {
  subjectId: string;
  open: boolean;
  onClose: () => void;
  onAdded: (t: AddedTopic) => void;
}) {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { play } = useSound();
  const uid = useId();

  function close() {
    setValue("");
    setError(null);
    onClose();
  }

  async function submit() {
    if (busy) return;
    const topic = cleanTopic(value);
    const local = !topic ? "Type a topic first." : topic.length > TOPIC_MAX ? `Keep it to ${TOPIC_MAX} characters.` : null;
    if (local) { setError(local); play("boop"); return; }
    setBusy(true);
    setError(null);
    const r = await addWeakTopic({ subjectId, topic }).catch(() => null);
    setBusy(false);
    if (!r || !r.ok) {
      setError(r ? r.error : "Couldn't add that. Try again.");
      play("boop");
      return;
    }
    play("pop");
    setValue("");
    onAdded(r.topic);
  }

  return (
    <Dialog open={open} onClose={close} title="Add a weak topic">
      <form className="flex flex-col gap-4" noValidate onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <p className="text-ink-soft">Something you already know you find tricky. It goes on your list until you&apos;ve got it.</p>
        <div className="field">
          <label htmlFor={`${uid}-topic`}>Topic</label>
          <input
            id={`${uid}-topic`} className="input text-base" autoFocus autoComplete="off" maxLength={TOPIC_MAX} placeholder="e.g. Krebs cycle"
            value={value} aria-invalid={error ? true : undefined}
            aria-describedby={`${uid}-hint${error ? ` ${uid}-err` : ""}`}
            onChange={(e) => { setValue(e.target.value); if (error) setError(null); }}
          />
          <p id={`${uid}-hint`} className="hint">Up to {TOPIC_MAX} characters.</p>
          {error && <p id={`${uid}-err`} className="error-text w-fit" role="alert">{error}</p>}
        </div>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={close}>Cancel</Button>
          <Button type="submit" variant="primary" sound={null} disabled={busy} aria-busy={busy || undefined}>{busy ? "Adding…" : "Add"}</Button>
        </div>
      </form>
    </Dialog>
  );
}
