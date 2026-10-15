"use client";
// One shared read-aloud controller (read-aloud.md): only one thing reads at a time, one
// utterance per sentence (reliable highlighting, no Chrome cut-offs), pause = cancel and
// resume from the start of the sentence (Android's pause() is broken).
import { useEffect, useState, useSyncExternalStore } from "react";
import { DEFAULT_PREFS, parsePrefs, pickVoice, PREFS_KEY, type ReadAloudPrefs } from "@/lib/speech/sentences";

export type Segment = { text: string; start: number; end: number; part?: string; gapBefore?: number };
export type SpeechStatus = "idle" | "playing" | "paused" | "finished" | "stopped";
export type SpeechState = { owner: string | null; status: SpeechStatus; index: number; total: number; message: string | null };

const IDLE: SpeechState = { owner: null, status: "idle", index: 0, total: 0, message: null };
let state: SpeechState = IDLE;
let segments: Segment[] = [];
let token = 0;
let errorsInRow = 0;
let gapTimer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
let onSpeakingChange: ((on: boolean) => void) | null = null;
let onFail: (() => void) | null = null;

function set(patch: Partial<SpeechState>) {
  state = { ...state, ...patch };
  onSpeakingChange?.(state.status === "playing");
  listeners.forEach((l) => l());
}

export const speechSupported = () => typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance !== "undefined";

export function readPrefs(): ReadAloudPrefs {
  try { return parsePrefs(localStorage.getItem(PREFS_KEY)); } catch { return DEFAULT_PREFS; }
}
export function writePrefs(p: Partial<ReadAloudPrefs>) {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...p })); } catch {}
}

function cancelAll() {
  token++;
  if (gapTimer) { clearTimeout(gapTimer); gapTimer = null; }
  if (speechSupported()) window.speechSynthesis.cancel();
}

function speakFrom(i: number) {
  cancelAll();
  const my = token;
  if (i >= segments.length) {
    set({ status: "finished", index: 0, message: "Finished" });
    return;
  }
  set({ status: "playing", index: i });
  const seg = segments[i];
  const go = () => {
    if (my !== token) return;
    const prefs = readPrefs(); // speed or voice changes apply from the next sentence
    const u = new SpeechSynthesisUtterance(seg.text);
    const voice = pickVoice(window.speechSynthesis.getVoices(), prefs.voiceURI, document.documentElement.lang || "en");
    if (voice) { u.voice = voice; u.lang = voice.lang; }
    u.rate = prefs.rate;
    u.onend = () => {
      if (my !== token) return;
      errorsInRow = 0;
      speakFrom(i + 1);
    };
    u.onerror = (e) => {
      if (my !== token || e.error === "interrupted" || e.error === "canceled") return;
      errorsInRow++;
      if (errorsInRow >= 3) {
        errorsInRow = 0;
        cancelAll();
        set({ status: "stopped", message: "Read aloud stopped. Try another voice." });
        onFail?.();
        return;
      }
      set({ message: "Couldn't read that sentence. Skipping…" });
      speakFrom(i + 1);
    };
    window.speechSynthesis.speak(u);
  };
  if (seg.gapBefore) gapTimer = setTimeout(go, seg.gapBefore);
  else go();
}

export const speech = {
  /** Starts reading `list` for `owner`, stopping anything else that was reading. */
  start(owner: string, list: Segment[], from = 0) {
    if (!speechSupported()) return;
    segments = list;
    errorsInRow = 0;
    set({ owner, total: list.length, message: "Reading" });
    speakFrom(from);
  },
  pause() {
    if (state.status !== "playing") return;
    cancelAll();
    set({ status: "paused", message: "Paused" });
  },
  resume() {
    if (state.status !== "paused") return;
    set({ message: "Reading" });
    speakFrom(state.index);
  },
  stop(message: string | null = null) {
    cancelAll();
    set({ ...IDLE, owner: state.owner, status: state.owner ? "stopped" : "idle", message });
  },
  /** Stops only if `owner` is the one reading (leaving a page, closing or flipping a card). */
  stopIf(owner: string, message: string | null = null) {
    if (state.owner === owner && (state.status === "playing" || state.status === "paused")) speech.stop(message);
  },
  /** Updates the status message (announced politely by the player). */
  note(message: string) { set({ message }); },
  get: () => state,
  /** The segments being read (for highlighting the current one). */
  segments: () => segments,
  subscribe(l: () => void) { listeners.add(l); return () => listeners.delete(l); },
  /** Wired by the sound provider: "speech wins" and the error boop. */
  bind(speaking: (on: boolean) => void, fail: () => void) { onSpeakingChange = speaking; onFail = fail; },
};

export function useSpeechState(): SpeechState {
  return useSyncExternalStore(speech.subscribe, speech.get, () => IDLE);
}

/** Voices on this device; waits up to 1.5 s for `voiceschanged` (getVoices() starts empty in Chrome). */
export function useVoices() {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    if (!speechSupported()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSupported(false);
      setLoading(false);
      return;
    }
    const read = () => {
      const list = window.speechSynthesis.getVoices();
      setVoices(list);
      if (list.length) setLoading(false);
    };
    read();
    window.speechSynthesis.addEventListener?.("voiceschanged", read);
    const t = setTimeout(() => setLoading(false), 1500);
    return () => { clearTimeout(t); window.speechSynthesis.removeEventListener?.("voiceschanged", read); };
  }, []);
  return { voices, loading, supported };
}
