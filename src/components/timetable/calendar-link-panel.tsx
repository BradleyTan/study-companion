"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { dayMonth, localOf } from "@/lib/timetable/dates";
import { agoLabel, webcalUrl } from "@/lib/timetable/grid";
import { getCalendarLink, makeCalendarLink, resetCalendarLink, turnOffCalendarLink } from "@/server/actions/timetable";
import type { CalendarLinkView } from "@/server/timetable";
import { useSound } from "../sound-provider";
import { Button } from "../ui/button";
import { useActionToast } from "../ui/action-toast";
import { usePhone } from "../ui/use-media";
import { LockIcon } from "./icons";

type Tab = "google" | "apple" | "outlook";
const TABS: { id: Tab; label: string }[] = [{ id: "google", label: "Google" }, { id: "apple", label: "Apple" }, { id: "outlook", label: "Outlook" }];
const MAKE_FAILED = "Couldn't make the link. Try again.";

function deviceTab(): Tab {
  if (typeof navigator === "undefined") return "google";
  return /iPhone|iPad|iPod|Macintosh|Mac OS X/i.test(navigator.userAgent) ? "apple" : "google";
}

/**
 * "Your calendar link" (timetable.md "Calendar link panel"): the same content in the timetable's
 * side panel and inline in Settings. It reads the link again each time it's shown; nothing is
 * created until "Make my calendar link" is pressed.
 */
export function CalendarLinkContent({ timezone, initial, headingLevel = 3 }: { timezone: string; initial?: CalendarLinkView; headingLevel?: 3 | 4 }) {
  const { play } = useSound();
  const toast = useActionToast();
  const uid = useId();
  const input = useRef<HTMLInputElement>(null);
  const [link, setLink] = useState<CalendarLinkView | undefined>(initial);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyHelp, setCopyHelp] = useState(false);
  const [confirm, setConfirm] = useState<"reset" | "off" | null>(null);
  const [tab, setTab] = useState<Tab>("google");
  const [announce, setAnnounce] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTab(deviceTab());
    let alive = true;
    getCalendarLink().then((r) => { if (alive && r.ok) setLink(r.link); }).catch(() => { if (alive) setLoadFailed(true); });
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(t);
  }, [copied]);

  async function run(fn: () => Promise<{ ok: true; link: CalendarLinkView } | { ok: false; error: string }>, after?: (l: CalendarLinkView) => void) {
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) throw new Error(r.error);
      setLink(r.link);
      setConfirm(null);
      setCopyHelp(false);
      after?.(r.link);
    } catch {
      setError(MAKE_FAILED);
      play("boop");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setCopyHelp(false);
      setAnnounce("");
      setTimeout(() => setAnnounce("Link copied"), 50);
    } catch {
      input.current?.focus();
      input.current?.select();
      setCopyHelp(true);
    }
  }

  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === "ArrowRight") next = (i + 1) % TABS.length;
    else if (e.key === "ArrowLeft") next = (i + TABS.length - 1) % TABS.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    play("click");
    setTab(TABS[next].id);
    document.getElementById(`${uid}-tab-${TABS[next].id}`)?.focus();
  };

  const H = headingLevel === 4 ? "h4" : "h3";
  const intro = "A private link that shows your StudyNest timetable in Google, Apple or Outlook Calendar. When you change a slot here, your calendar catches up by itself.";

  if (link === undefined) {
    return (
      <div className="flex flex-col gap-3">
        <p>{intro}</p>
        <p className="hint" aria-live="polite">{loadFailed ? "We couldn't check your calendar link. Close this and try again." : "…"}</p>
      </div>
    );
  }

  if (link === null) {
    return (
      <div className="flex flex-col items-start gap-3" data-testid="calendar-link">
        <p>{intro}</p>
        <Button variant="primary" disabled={busy} onClick={() => void run(makeCalendarLink)}>{busy ? "Making…" : "Make my calendar link"}</Button>
        {error && <p className="error-text" role="alert">{error}</p>}
        {toast.node}
      </div>
    );
  }

  const made = dayMonth(localOf(timezone, Date.parse(link.createdAt)).day);
  const checked = link.lastFetchedAt ? `Last checked by your calendar ${agoLabel(Date.parse(link.lastFetchedAt), now)}` : "Not checked by a calendar yet";
  return (
    <div className="flex flex-col gap-4" data-testid="calendar-link">
      <p>{intro}</p>
      <div className="field">
        <label htmlFor={`${uid}-url`}>Calendar link</label>
        <input id={`${uid}-url`} ref={input} className="input mono" readOnly value={link.url} onFocus={(e) => e.currentTarget.select()} data-testid="calendar-url" />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" onClick={() => void copy()}>{copied ? <><span aria-hidden="true">✓</span> Copied!</> : "Copy link"}</Button>
        {copyHelp && <p className="font-bold" role="status">Press Ctrl+C (or ⌘C) to copy</p>}
        <span className="sr-only" aria-live="polite">{announce}</span>
      </div>
      <p className="flex items-start gap-2"><span className="mt-1 shrink-0"><LockIcon /></span>Anyone with this link can see your timetable. Keep it to yourself.</p>
      <p className="hint" data-testid="calendar-status">Made {made} · {checked}</p>

      <div>
        <div role="tablist" aria-label="Calendar app" className="tabs">
          {TABS.map((t) => (
            <button
              key={t.id} id={`${uid}-tab-${t.id}`} type="button" role="tab" className="tab" aria-selected={tab === t.id}
              aria-controls={`${uid}-panel`} tabIndex={tab === t.id ? 0 : -1} onKeyDown={onTabKey}
              onClick={() => { play("click"); setTab(t.id); }}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${tab}`} className="flex flex-col gap-3 pt-3" tabIndex={0}>
          {tab === "google" && (
            <>
              <ol className="steps">
                <li>Copy the link above.</li>
                <li>On a computer, open calendar.google.com (the phone app can&apos;t add links).</li>
                <li>Next to &quot;Other calendars&quot;, click <strong>+</strong>, then <strong>From URL</strong>.</li>
                <li>Paste the link and click <strong>Add calendar</strong>.</li>
                <li>It shows under &quot;Other calendars&quot;, and on your phone too.</li>
              </ol>
              <p className="hint">Google checks for changes a few times a day, so a new slot can take up to 24 hours to appear.</p>
            </>
          )}
          {tab === "apple" && (
            <>
              <a className="btn self-start" href={webcalUrl(link.url)} onClick={() => play("click")}>Open in Apple Calendar</a>
              <p>Or by hand on iPhone:</p>
              <ol className="steps">
                <li>Copy the link.</li>
                <li>Open <strong>Settings → Apps → Calendar → Calendar Accounts → Add Account → Other</strong> (older iOS: Settings → Calendar → Accounts).</li>
                <li>Tap <strong>Add Subscribed Calendar</strong>, paste, tap <strong>Next</strong>, then <strong>Save</strong>.</li>
              </ol>
              <p>On a Mac: Calendar → <strong>File → New Calendar Subscription</strong>, paste, <strong>Subscribe</strong>, set Auto-refresh to <strong>Every hour</strong>.</p>
            </>
          )}
          {tab === "outlook" && (
            <>
              <ol className="steps">
                <li>Copy the link.</li>
                <li>Open Outlook on the web (outlook.com or your uni&apos;s Outlook) and go to Calendar.</li>
                <li>Click <strong>Add calendar → Subscribe from web</strong>.</li>
                <li>Paste the link, name it &quot;StudyNest&quot;, click <strong>Import</strong>.</li>
              </ol>
              <p className="hint">Outlook checks for changes every few hours.</p>
            </>
          )}
          <p className="hint">Menus move around sometimes. If a step looks different, search your calendar&apos;s help for &apos;subscribe by URL&apos;.</p>
        </div>
      </div>

      <div className="flex flex-col items-start gap-2 border-t-2 border-ink pt-4">
        <H className="font-bold">Link shared by mistake?</H>
        {confirm === "reset" ? (
          <div role="group" aria-label="Confirm reset" className="flex flex-col gap-2">
            <p>Reset your calendar link? The old link stops working straight away. You&apos;ll need to add the new one to your calendar again.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" sound={null} disabled={busy} onClick={() => void run(resetCalendarLink, () => { play("tear"); toast.show("New link made. The old one no longer works.", undefined, 4000); })}>Reset link</Button>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
            </div>
          </div>
        ) : confirm === "off" ? (
          <div role="group" aria-label="Confirm turn off" className="flex flex-col gap-2">
            <p>Turn off your calendar link? Calendars using it will stop updating.</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="danger" sound={null} disabled={busy} onClick={() => void run(turnOffCalendarLink, () => play("tear"))}>Turn off link</Button>
              <Button onClick={() => setConfirm(null)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setConfirm("reset")}>Reset link</Button>
            <Button variant="ghost" onClick={() => setConfirm("off")}>Turn off link</Button>
          </div>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
      </div>
      {toast.node}
    </div>
  );
}

/** The timetable's "Add to my calendar" panel: a side panel from 640 px, a bottom sheet on phones. */
export function CalendarLinkPanel({ open, onClose, timezone }: { open: boolean; onClose: () => void; timezone: string }) {
  const ref = useRef<HTMLDialogElement>(null);
  const phone = usePhone();
  const title = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); title.current?.focus(); }
    if (!open && d.open) d.close();
  }, [open, phone]);
  return (
    <dialog
      key={phone ? "phone" : "side"}
      ref={ref}
      className={phone ? "form-sheet" : "side-panel link-side"}
      aria-labelledby="calendar-link-title"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      data-testid="calendar-panel"
    >
      {open && (
        <div className="flex min-h-full flex-col">
          {phone && <div className="sheet-handle" aria-hidden="true" />}
          <div className="flex items-center gap-2 border-b-2 border-ink px-4 py-3">
            <h2 id="calendar-link-title" ref={title} tabIndex={-1} className="min-w-0 flex-1 text-xl font-bold">Your calendar link</h2>
            <Button variant="ghost" className="icon-btn min-h-11" aria-label="Close" title="Close" onClick={onClose}>
              <span aria-hidden="true" className="text-xl leading-none">×</span>
            </Button>
          </div>
          <div className="px-4 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] pt-4">
            <CalendarLinkContent timezone={timezone} />
          </div>
        </div>
      )}
    </dialog>
  );
}
