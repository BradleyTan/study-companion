"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { updateSettings } from "@/server/actions/settings";
import { speech } from "./read-aloud/speech";
import { allowed, playSound, type SoundName } from "@/lib/sound/engine";

type SoundPrefs = { soundOn: boolean; volume: number };
type Ctx = SoundPrefs & {
  /** `duringSpeech`: the read-aloud controls' own click still plays while speech is playing. */
  play: (name: SoundName, opts?: { duringSpeech?: boolean }) => void;
  /** Speech wins (sounds.md): while read-aloud speaks, other UI sounds are skipped. */
  setSpeaking: (on: boolean) => void;
  setPrefs: (p: Partial<SoundPrefs>) => void;
  /** Focus mode (study timer, Step 4): only the timer chime plays. Set by the TimerProvider. */
  focusMode: boolean;
  setFocusMode: (on: boolean) => void;
};

const KEY = "studynest:sound";
const DEFAULTS: SoundPrefs = { soundOn: true, volume: 0.35 };
const SoundContext = createContext<Ctx | null>(null);

function readStored(): SoundPrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (v && typeof v.soundOn === "boolean" && typeof v.volume === "number") return v;
  } catch {}
  return DEFAULTS;
}

export function SoundProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefsState] = useState<SoundPrefs>(DEFAULTS);
  const [focusMode, setFocusMode] = useState(false);
  const speaking = useRef(false);
  const setSpeaking = useCallback((on: boolean) => { speaking.current = on; }, []);

  // Read this device's saved prefs after mount (localStorage isn't available during SSR).
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setPrefsState(readStored()), []);

  const setPrefs = useCallback((p: Partial<SoundPrefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...p };
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const play = useCallback(
    (name: SoundName, opts?: { duringSpeech?: boolean }) => {
      if (!allowed(name, { soundOn: prefs.soundOn, focusMode, speaking: speaking.current, duringSpeech: opts?.duringSpeech })) return;
      playSound(name, prefs.volume);
    },
    [prefs, focusMode],
  );

  // Speech wins: while read-aloud speaks, other sounds are skipped; its failure gets one boop.
  useEffect(() => speech.bind(setSpeaking, () => play("boop")), [setSpeaking, play]);

  const value = useMemo(() => ({ ...prefs, play, setPrefs, focusMode, setFocusMode, setSpeaking }), [prefs, play, setPrefs, focusMode, setSpeaking]);
  return <SoundContext value={value}>{children}</SoundContext>;
}

export function useSound(): Ctx {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error("useSound must be used inside <SoundProvider>");
  return ctx;
}

/** Applies the signed-in student's saved sound and theme once on load (profile wins over this device). */
export function ProfileSync({ soundOn, volume, theme, timezone }: SoundPrefs & { theme: "system" | "light" | "dark"; timezone?: string }) {
  const { setPrefs } = useSound();
  useEffect(() => {
    setPrefs({ soundOn, volume });
    applyTheme(theme);
  }, [soundOn, volume, theme, setPrefs]);
  // "Due today" and daily limits reset at the student's local midnight, so keep the time zone current.
  useEffect(() => {
    let tz: string | undefined;
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch {}
    if (tz && timezone && tz !== timezone) void updateSettings({ timezone: tz }).catch(() => {});
  }, [timezone]);
  return null;
}

export function applyTheme(theme: "system" | "light" | "dark") {
  try { localStorage.setItem("studynest:theme", theme); } catch {}
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}
