"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { playSound, type SoundName } from "@/lib/sound/engine";

type SoundPrefs = { soundOn: boolean; volume: number };
type Ctx = SoundPrefs & {
  play: (name: SoundName) => void;
  setPrefs: (p: Partial<SoundPrefs>) => void;
  /** Focus mode (Pomodoro, Step 4): only the timer chime plays. */
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
    (name: SoundName) => {
      if (!prefs.soundOn) return;
      if (focusMode && name !== "chime") return;
      playSound(name, prefs.volume);
    },
    [prefs, focusMode],
  );

  const value = useMemo(() => ({ ...prefs, play, setPrefs, focusMode, setFocusMode }), [prefs, play, setPrefs, focusMode]);
  return <SoundContext value={value}>{children}</SoundContext>;
}

export function useSound(): Ctx {
  const ctx = useContext(SoundContext);
  if (!ctx) throw new Error("useSound must be used inside <SoundProvider>");
  return ctx;
}

/** Applies the signed-in student's saved sound and theme once on load (profile wins over this device). */
export function ProfileSync({ soundOn, volume, theme }: SoundPrefs & { theme: "system" | "light" | "dark" }) {
  const { setPrefs } = useSound();
  useEffect(() => {
    setPrefs({ soundOn, volume });
    applyTheme(theme);
  }, [soundOn, volume, theme, setPrefs]);
  return null;
}

export function applyTheme(theme: "system" | "light" | "dark") {
  try { localStorage.setItem("studynest:theme", theme); } catch {}
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", theme);
}
