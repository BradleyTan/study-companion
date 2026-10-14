"use client";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { splitSentences } from "@/lib/speech/sentences";
import { useSound } from "../sound-provider";
import { speech, useSpeechState, useVoices, type Segment } from "./speech";

/** Sentences of one or more labelled parts, with an optional pause between parts (card front → back). */
export function segmentsOf(parts: { part: string; text: string; gapBefore?: number }[]): Segment[] {
  const out: Segment[] = [];
  for (const p of parts) {
    splitSentences(p.text).forEach((s, i) => out.push({ ...s, part: p.part, gapBefore: i === 0 ? p.gapBefore : undefined }));
  }
  return out;
}

export const NO_SPEECH = "Read aloud isn't available in this browser. Try Chrome, Edge or Safari.";
export const NO_VOICES = "Your device has no reading voices installed. On Linux, install a speech package such as speech-dispatcher, then restart the browser.";

/**
 * Speaker button for cards and passages. Toggles reading; when the browser can't speak it
 * stays visible (aria-disabled) and explains why in a small popover.
 */
export function ReadAloudButton({ owner, parts, label, className = "", children, firstAction }: {
  owner: string;
  parts: () => { part: string; text: string; gapBefore?: number }[];
  label: string;
  className?: string;
  children?: ReactNode;
  /** Marks the card's first action (focus target after deleting the card above). */
  firstAction?: boolean;
}) {
  const s = useSpeechState();
  const { voices, loading, supported } = useVoices();
  const { play } = useSound();
  const [note, setNote] = useState<string | null>(null);
  const tipId = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const reading = s.owner === owner && (s.status === "playing" || s.status === "paused");
  const unavailable = !supported || (!loading && voices.length === 0);

  useEffect(() => () => speech.stopIf(owner), [owner]);
  useEffect(() => {
    if (!note) return;
    const close = (e: KeyboardEvent | MouseEvent) => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      if (e instanceof MouseEvent && ref.current?.contains(e.target as Node)) return;
      setNote(null);
    };
    document.addEventListener("keydown", close);
    document.addEventListener("click", close);
    return () => { document.removeEventListener("keydown", close); document.removeEventListener("click", close); };
  }, [note]);

  return (
    <span className="relative inline-flex">
      <button
        ref={ref}
        type="button"
        className={`btn btn-sm icon-btn ${className}`}
        aria-label={reading ? `Stop reading: ${label}` : `Read aloud: ${label}`}
        title={reading ? "Stop reading" : "Read aloud"}
        aria-pressed={reading}
        aria-disabled={unavailable || undefined}
        aria-describedby={note ? tipId : undefined}
        data-first-action={firstAction || undefined}
        onClick={() => {
          play("click", { duringSpeech: true });
          if (unavailable) { setNote(supported ? NO_VOICES : NO_SPEECH); return; }
          if (reading) speech.stop();
          else speech.start(owner, segmentsOf(parts()));
        }}
      >
        {children ?? <SpeakerIcon />}
      </button>
      {note && (
        <span id={tipId} role="status" className="sticker absolute right-0 top-full z-40 mt-2 w-64 p-3 text-sm font-normal normal-case">
          {note}
        </span>
      )}
    </span>
  );
}

/** Renders text with the sentence being read marked. */
export function SpokenText({ owner, part, text }: { owner: string; part: string; text: string }) {
  const s = useSpeechState();
  if (s.owner !== owner || (s.status !== "playing" && s.status !== "paused")) return <>{text}</>;
  const seg = speech.segments()[s.index];
  if (!seg || seg.part !== part) return <>{text}</>;
  return <>{text.slice(0, seg.start)}<mark>{text.slice(seg.start, seg.end)}</mark>{text.slice(seg.end)}</>;
}

export function SpeakerIcon() {
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" />
      <path d="M16.5 8.5a5 5 0 0 1 0 7" />
      <path d="M19 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}
