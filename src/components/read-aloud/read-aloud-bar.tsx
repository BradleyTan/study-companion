"use client";
import { useEffect, useId, useState } from "react";
import { groupVoices, RATES } from "@/lib/speech/sentences";
import { useSound } from "../sound-provider";
import { Button } from "../ui/button";
import { NO_SPEECH, NO_VOICES } from "./read-aloud-button";
import { readPrefs, speech, useSpeechState, useVoices, writePrefs, type Segment } from "./speech";

/**
 * Player bar under the note editor toolbar (read-aloud.md "Player bar").
 * `getSegments` returns the sentences to read (from the cursor or the selection).
 */
export function ReadAloudBar({ owner, getSegments, onClose, empty }: {
  owner: string;
  /** `fromTop`: after "Finished", Play starts again from the top. */
  getSegments: (fromTop: boolean) => { segments: Segment[]; note?: string };
  onClose: () => void;
  empty: boolean;
}) {
  const s = useSpeechState();
  const { voices, loading, supported } = useVoices();
  const { play } = useSound();
  const [rate, setRate] = useState(1);
  const [voiceURI, setVoiceURI] = useState<string>("");
  const uid = useId();
  const mine = s.owner === owner;
  const playing = mine && s.status === "playing";
  const paused = mine && s.status === "paused";

  useEffect(() => {
    const p = readPrefs();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRate(p.rate);
    setVoiceURI(p.voiceURI ?? "");
  }, []);

  const lang = typeof document !== "undefined" ? document.documentElement.lang || "en" : "en";
  const { onDevice, online, matches } = groupVoices(voices, lang);
  const selected = voices.find((v) => v.voiceURI === voiceURI) ? voiceURI : (onDevice.find(matches) ?? onDevice[0] ?? online[0])?.voiceURI ?? "";

  function toggle() {
    play("click", { duringSpeech: true });
    if (playing) { speech.pause(); return; }
    if (paused) { speech.resume(); return; }
    const { segments, note } = getSegments(mine && s.status === "finished");
    if (!segments.length) return;
    speech.start(owner, segments);
    if (note) speech.note(note);
  }

  // Alt+Shift+R toggles Play/Pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.shiftKey && (e.key === "R" || e.key === "r" || e.code === "KeyR")) { e.preventDefault(); toggle(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const status = !supported ? NO_SPEECH
    : !loading && voices.length === 0 ? NO_VOICES
    : empty && !mine ? "Nothing to read yet"
    : playing ? `Reading sentence ${s.index + 1} of ${s.total}`
    : paused ? `Paused at sentence ${s.index + 1} of ${s.total}`
    : mine && s.message ? s.message
    : "Ready";
  const unavailable = !supported || (!loading && voices.length === 0);

  const voiceLabel = (v: SpeechSynthesisVoice) => `${v.name} (${v.lang})${v.localService ? "" : " (online)"}`;

  return (
    <section role="region" aria-label="Read aloud" className="sticker flex flex-col gap-2 p-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" sound={null} className="min-h-11" aria-pressed={playing} disabled={unavailable || (empty && !mine)} onClick={toggle}>
          {playing ? "❚❚ Pause" : "▶ Play"}
        </Button>
        <Button size="sm" sound={null} className="min-h-11" disabled={!mine || (!playing && !paused)} onClick={() => { play("click", { duringSpeech: true }); speech.stop("Stopped"); }}>■ Stop</Button>
        <span className="min-w-0 flex-1 truncate text-sm font-bold sm:flex-none" data-testid="read-aloud-status">{status}</span>
        <Button variant="ghost" size="sm" sound={null} className="icon-btn ml-auto min-h-11 sm:hidden" aria-label="Close read aloud" onClick={() => { play("click", { duringSpeech: true }); speech.stopIf(owner); onClose(); }}>✕</Button>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex sm:min-w-0 sm:flex-1 sm:flex-wrap sm:items-center">
        <label className="flex flex-col text-sm font-bold sm:flex-row sm:items-center sm:gap-1" htmlFor={`${uid}-rate`}>
          Speed
          <select id={`${uid}-rate`} className="input min-h-11 py-1" value={rate}
            onChange={(e) => { play("click", { duringSpeech: true }); const r = Number(e.target.value); setRate(r); writePrefs({ rate: r }); }}>
            {RATES.map((r) => <option key={r} value={r}>{r}×</option>)}
          </select>
        </label>
        <label className="flex min-w-0 flex-col text-sm font-bold sm:min-w-56 sm:flex-1 sm:flex-row sm:items-center sm:gap-1" htmlFor={`${uid}-voice`}>
          Voice
          <select id={`${uid}-voice`} className="input min-h-11 min-w-0 py-1 sm:flex-1" value={selected} disabled={loading || voices.length === 0} aria-describedby={online.length ? `${uid}-online` : undefined}
            onChange={(e) => { play("click", { duringSpeech: true }); setVoiceURI(e.target.value); writePrefs({ voiceURI: e.target.value }); }}>
            {loading && voices.length === 0 ? <option value="">Loading voices…</option> : null}
            {onDevice.length > 0 && (
              <optgroup label="On this device">
                {onDevice.filter(matches).map((v) => <option key={v.voiceURI} value={v.voiceURI}>{voiceLabel(v)}</option>)}
                {onDevice.filter((v) => !matches(v)).map((v) => <option key={v.voiceURI} value={v.voiceURI}>{voiceLabel(v)} · other language</option>)}
              </optgroup>
            )}
            {online.length > 0 && (
              <optgroup label="Online">
                {online.map((v) => <option key={v.voiceURI} value={v.voiceURI}>{voiceLabel(v)}{matches(v) ? "" : " · other language"}</option>)}
              </optgroup>
            )}
          </select>
        </label>
        {online.length > 0 && <p id={`${uid}-online`} className="hint col-span-2 sm:basis-full">Online voices send the text to your browser&apos;s maker to be spoken.</p>}
      </div>
      <Button variant="ghost" size="sm" sound={null} className="icon-btn hidden min-h-11 sm:inline-flex" aria-label="Close read aloud" onClick={() => { play("click", { duringSpeech: true }); speech.stopIf(owner); onClose(); }}>✕</Button>
      <p className="sr-only" aria-live="polite">{mine ? s.message : ""}</p>
    </section>
  );
}
