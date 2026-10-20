"use client";
import { useState } from "react";
import { RANGES, type TimerPrefs } from "@/lib/timer/machine";
import { useSound } from "../sound-provider";
import { useToast } from "../ui/live-toast";
import { DurationStepper } from "./duration-stepper";
import { useTimer } from "./timer-provider";

/** Settings "Study timer" card (settings.md 3). Saved at once; a running phase keeps its length. */
export function TimerSettings() {
  const t = useTimer();
  const { play } = useSound();
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const { prefs } = t;

  const save = async (patch: Partial<TimerPrefs>) => toast.show((await t.setPrefs(patch)) ? "Saved" : "Couldn't save. Try again.");
  const n = t.notify;

  return (
    <section aria-labelledby="timer-h" className="sticker flex flex-col gap-4 p-5" data-testid="timer-settings">
      <h2 id="timer-h" className="text-xl font-bold">Study timer</h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <DurationStepper wide label="Focus" what="focus" unit="min" value={prefs.focusMin} {...RANGES.focusMin} onChange={(v) => void save({ focusMin: v })} />
        <DurationStepper wide label="Short break" what="short break" unit="min" value={prefs.shortMin} {...RANGES.shortMin} onChange={(v) => void save({ shortMin: v })} />
        <DurationStepper wide label="Long break" what="long break" unit="min" value={prefs.longMin} {...RANGES.longMin} onChange={(v) => void save({ longMin: v })} />
        <DurationStepper wide label="Long break after" what="rounds" unit="rounds" value={prefs.longEvery} {...RANGES.longEvery} onChange={(v) => void save({ longEvery: v })} />
      </div>
      <p className="hint">A round that is already running keeps its length; changes apply from the next one.</p>

      <label className="flex items-center gap-3 font-bold">
        <input
          type="checkbox" className="h-6 w-6 shrink-0 accent-[var(--ink)]" checked={prefs.autoStart}
          onChange={(e) => { play("click"); void save({ autoStart: e.target.checked }); }}
        />
        Start the next round or break by itself
      </label>

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-3 font-bold">
          <input
            type="checkbox" className="h-6 w-6 shrink-0 accent-[var(--ink)]" checked={prefs.focusQuiet} aria-describedby="focus-quiet-help"
            onChange={(e) => { play("click"); void save({ focusQuiet: e.target.checked }); }}
          />
          Quiet the app while I focus
        </label>
        <p id="focus-quiet-help" className="hint">During a focus round only the end chime plays and animations calm down.</p>
      </div>

      <div className="flex flex-col gap-1">
        <label className="flex items-center gap-3 font-bold">
          <input
            type="checkbox" className="h-6 w-6 shrink-0 accent-[var(--ink)]" aria-describedby="notify-help"
            checked={n.enabled} disabled={n.state === "denied" || n.state === "unsupported" || asking}
            onChange={async (e) => {
              play("click");
              setAsking(true);
              await n.setEnabled(e.target.checked);
              setAsking(false);
            }}
          />
          Tell me when time&apos;s up, even in another tab
        </label>
        <div id="notify-help" className="flex flex-col gap-1">
          {n.state === "granted" && n.enabled && <p className="hint">On for this browser.</p>}
          {n.state === "denied" && (
            <>
              <p className="hint">Notifications are blocked in your browser. The chime and the tab title still tell you when time&apos;s up.</p>
              <details className="hint">
                <summary className="cursor-pointer underline underline-offset-4">How to unblock</summary>
                <p className="mt-1">Click the lock or settings icon next to the web address and allow notifications.</p>
              </details>
            </>
          )}
          {n.state === "unsupported" && <p className="hint">This browser can&apos;t show notifications. The chime and the tab title still work.</p>}
          <p className="hint">On phones, the alert may only appear when you come back to StudyNest if your browser was closed or the phone was asleep.</p>
        </div>
      </div>
      {toast.node}
    </section>
  );
}
