"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { deleteAccount, updateSettings } from "@/server/actions/settings";
import type { Profile } from "@/server/repo/types";
import { applyTheme, useSound } from "./sound-provider";
import { CalendarLinkContent } from "./timetable/calendar-link-panel";
import { TimerSettings } from "./timer/timer-settings";
import { Button } from "./ui/button";
import { useToast } from "./ui/live-toast";

export function SettingsForm({ profile }: { profile: Profile }) {
  const { soundOn, volume, setPrefs, play } = useSound();
  const [theme, setTheme] = useState(profile.theme);
  const [weekStart, setWeekStart] = useState(profile.weekStart);
  const [confirm, setConfirm] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, startDelete] = useTransition();
  const toast = useToast();

  const persist = async (patch: Parameters<typeof updateSettings>[0]) => {
    const res = await updateSettings(patch);
    toast.show(res.ok ? "Saved" : "Couldn't save. Try again.");
  };

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <section aria-labelledby="sound-h" className="sticker flex flex-col gap-4 p-5">
        <h2 id="sound-h" className="text-xl font-bold">Sound</h2>
        <label className="flex items-center gap-3 font-bold">
          <input
            id="sound-on" type="checkbox" className="h-6 w-6 accent-[var(--ink)]" checked={soundOn}
            onChange={(e) => { setPrefs({ soundOn: e.target.checked }); if (e.target.checked) play("click"); void persist({ soundOn: e.target.checked }); }}
          />
          Play sounds
        </label>
        <div className="field">
          <label htmlFor="volume">Volume: {Math.round(volume * 100)}%</label>
          <div className="flex items-center gap-3">
            <input
              id="volume" type="range" min={0} max={100} step={5} value={Math.round(volume * 100)} disabled={!soundOn} className="flex-1 accent-[var(--ink)]"
              onChange={(e) => setPrefs({ volume: Number(e.target.value) / 100 })}
              onPointerUp={() => void persist({ volume })} onKeyUp={() => void persist({ volume })}
            />
            <Button size="sm" sound="pop" disabled={!soundOn}>Test</Button>
          </div>
        </div>
        <p className="hint">Sounds are short and quiet. Everything works with sound off.</p>
      </section>

      <section aria-labelledby="theme-h" className="sticker flex flex-col gap-3 p-5">
        <h2 id="theme-h" className="text-xl font-bold">Theme</h2>
        <div role="radiogroup" aria-labelledby="theme-h" className="seg self-start">
          {(["system", "light", "dark"] as const).map((t) => (
            <label key={t}>
              <input
                type="radio" name="theme" value={t} checked={theme === t} className="sr-only"
                onChange={() => { setTheme(t); applyTheme(t); play("click"); void persist({ theme: t }); }}
              />
              {t === "system" ? "Match my device" : t === "light" ? "Light" : "Dark"}
            </label>
          ))}
        </div>
      </section>

      <TimerSettings />

      <section aria-labelledby="timetable-h" className="sticker flex flex-col gap-4 p-5">
        <h2 id="timetable-h" className="text-xl font-bold">Timetable and calendar</h2>
        <fieldset className="flex flex-col gap-2">
          <legend className="label mb-1">Week starts on</legend>
          <div className="seg self-start">
            {(["mon", "sun"] as const).map((w) => (
              <label key={w}>
                <input
                  type="radio" name="week-start" className="sr-only" checked={weekStart === w}
                  onChange={() => { setWeekStart(w); play("click"); void persist({ weekStart: w }); }}
                />
                {w === "mon" ? "Monday" : "Sunday"}
              </label>
            ))}
          </div>
        </fieldset>
        <p className="hint">Times are shown in {profile.timezone} (from this device).</p>
        <div className="flex flex-col gap-3 border-t-2 border-ink pt-4">
          <h3 className="text-lg font-bold">Calendar link</h3>
          <CalendarLinkContent timezone={profile.timezone} headingLevel={4} />
        </div>
      </section>

      <section aria-labelledby="data-h" className="sticker flex flex-col items-start gap-3 p-5">
        <h2 id="data-h" className="text-xl font-bold">Your data</h2>
        <p>Download your subjects, notes, the list of files you uploaded and the text we read from them, your flashcards, quizzes, chats, study sessions and timetable, as one JSON file. Your calendar link is never in it.</p>
        <a href="/api/export" className="btn" onClick={() => play("click")} download>Download everything</a>
        <Link href="/privacy" className="inline-flex min-h-11 items-center underline underline-offset-4" onClick={() => play("click")}>Read how we store your notes</Link>
      </section>

      <section aria-labelledby="delete-h" className="sticker flex flex-col gap-3 border-[var(--danger-line)] p-5">
        <h2 id="delete-h" className="text-xl font-bold">Delete account</h2>
        <p>This permanently deletes your account, notes and files. It can&apos;t be undone.</p>
        <p className="hint">Your calendar link stops working straight away too.</p>
        <div className="field">
          <label htmlFor="confirm-delete">Type DELETE to confirm</label>
          <input id="confirm-delete" className="input max-w-xs" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" aria-describedby={deleteError ? "delete-error" : undefined} />
        </div>
        {deleteError && <p id="delete-error" role="alert" className="error-text">{deleteError}</p>}
        <Button
          variant="danger" sound="tear" className="self-start" disabled={confirm !== "DELETE" || deleting}
          onClick={() => startDelete(async () => {
            const res = await deleteAccount(confirm);
            if (res && !res.ok) { setDeleteError(res.error); play("boop"); }
          })}
        >
          {deleting ? "Deleting…" : "Delete my account"}
        </Button>
      </section>
      {toast.node}
    </div>
  );
}
