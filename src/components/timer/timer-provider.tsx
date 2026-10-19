"use client";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from "react";
import { logStudySession } from "@/server/actions/timer";
import { updateSettings } from "@/server/actions/settings";
import type { SubjectColour } from "@/lib/subjects";
import * as copy from "@/lib/timer/copy";
import {
  addFive, afterEnd, displaySec, IDLE, isActive, pause, plannedFor, remainingMs, resume, selectPhase, setSubject, start, stop,
  type Ended, type Phase, type SessionLog, type TimerPrefs, type TimerState,
} from "@/lib/timer/machine";
import {
  claimEnd, enqueue, flushQueue, LAST_SUBJECT_KEY, NOTIFY_KEY, NUDGE_KEY, NUDGE_READY_KEY, NUDGE_SNOOZE_MS, parseTimer, QUEUE_KEY,
  readQueue, readTimer, STUCK_TRIES, TIMER_KEY, writeTimer, type KV, type QueueItem,
} from "@/lib/timer/store";
import { defaultSubjectId } from "@/lib/timer/subject";
import { mergeSessions, todayTally, type Tally, type TallySession } from "@/lib/timer/tally";
import { useSound } from "../sound-provider";
import { TimerPanel } from "./timer-panel";

export type TimerSubject = { id: string; name: string; colour: SubjectColour; emoji: string };
type NotifyState = "unsupported" | "default" | "granted" | "denied";

type Ctx = {
  /** False until this browser's stored timer has been read (Start waits for it). */
  hydrated: boolean;
  state: TimerState;
  /** The clock the screen was last drawn at (ms). */
  now: number;
  prefs: TimerPrefs;
  setPrefs: (patch: Partial<TimerPrefs>) => Promise<boolean>;
  subjects: TimerSubject[];
  subjectById: (id: string | null) => TimerSubject | null;
  /** The subject shown in the picker (the running round's, or the one a new round would get). */
  subjectId: string | null;
  chooseSubject: (id: string | null) => void;
  startPhase: (phase: Phase, opts?: { subjectId?: string | null }) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  addFiveMin: () => void;
  /** Stop (focus) or Skip break (break): logs a round of a minute or more as not completed. */
  stopTimer: () => void;
  endCardChoice: (choice: "skip_break" | "done") => void;
  choosePhase: (phase: Phase) => void;
  tally: Tally;
  sessions: TallySession[] | null;
  timezone: string;
  /** Rounds still waiting to be saved, and whether any has failed 3 times. */
  queued: number;
  stuck: number;
  panelOpen: boolean;
  openPanel: () => void;
  closePanel: () => void;
  chipRef: RefObject<HTMLButtonElement | null>;
  notify: {
    state: NotifyState;
    enabled: boolean;
    setEnabled: (on: boolean) => Promise<void>;
    nudge: boolean;
    dismissNudge: () => void;
  };
};

const TimerContext = createContext<Ctx | null>(null);

export function useTimer(): Ctx {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error("useTimer must be used inside <TimerProvider>");
  return ctx;
}

/** localStorage, or a do-nothing stand-in where it's blocked (private mode, tests). */
function storage(): KV {
  try {
    const ls = window.localStorage;
    ls.getItem(TIMER_KEY);
    return ls;
  } catch {
    return { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  }
}

const toTally = (l: SessionLog): TallySession => ({ clientKey: l.clientKey, subjectId: l.subjectId, kind: l.kind, focusedSec: l.focusedSec, completed: l.completed, endedAt: l.endedAt });

async function saveLog(log: SessionLog): Promise<"saved" | "rejected"> {
  const res = await logStudySession(log);
  return res.ok ? "saved" : "rejected";
}

function notifyState(): NotifyState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission;
}

async function swRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  try {
    return (await navigator.serviceWorker.getRegistration("/")) ?? (await navigator.serviceWorker.register("/sw.js"));
  } catch {
    return null;
  }
}

/**
 * The study timer (timer.md). One provider in the app layout owns the state, so navigation never
 * resets it; the header chip, the panel, `/timer` and the subject page read it.
 */
export function TimerProvider({ children, subjects, prefs: initialPrefs, sessions: serverSessions, timezone, serverNow }: {
  children: ReactNode;
  subjects: TimerSubject[];
  prefs: TimerPrefs;
  /** This week's saved phases (null: they didn't load). */
  sessions: TallySession[] | null;
  timezone: string;
  /** The server's clock for the first render (so the tally renders the same on both sides). */
  serverNow: number;
}) {
  const { play, setFocusMode, soundOn } = useSound();
  const pathname = usePathname();
  const [hydrated, setHydrated] = useState(false);
  const [state, setState] = useState<TimerState>(IDLE);
  const stateRef = useRef<TimerState>(IDLE);
  const [now, setNow] = useState(serverNow);
  const [prefs, setPrefsState] = useState(initialPrefs);
  const prefsRef = useRef(initialPrefs);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [saved, setSaved] = useState<SessionLog[]>([]);
  const [lastUsed, setLastUsed] = useState<string | null>(null);
  const [picked, setPicked] = useState<{ path: string | null; id: string | null } | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const [notify, setNotify] = useState<NotifyState>("unsupported");
  const [notifyOn, setNotifyOn] = useState(false);
  const [nudgeReady, setNudgeReady] = useState(false);
  const [nudgeSnoozed, setNudgeSnoozed] = useState(true);
  const [unseenEnd, setUnseenEnd] = useState(false);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  const tabId = useRef("");
  const flushing = useRef(false);
  const soundOnRef = useRef(soundOn);
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);

  // Profile defaults changed elsewhere (settings saved, another device): follow them.
  const { focusMin, shortMin, longMin, longEvery, autoStart, focusQuiet } = initialPrefs;
  useEffect(() => {
    const p = { focusMin, shortMin, longMin, longEvery, autoStart, focusQuiet };
    prefsRef.current = p;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrefsState(p);
  }, [focusMin, shortMin, longMin, longEvery, autoStart, focusQuiet]);

  const apply = useCallback((next: TimerState, persist = true) => {
    stateRef.current = next;
    if (persist) writeTimer(storage(), next);
    setState(next);
    setNow(Date.now());
  }, []);

  const announce = useCallback((text: string) => {
    // Cleared first, so the same words twice are still announced.
    setAnnouncement("");
    setTimeout(() => setAnnouncement(text), 60);
  }, []);

  const subjectById = useCallback((id: string | null) => (id ? subjects.find((s) => s.id === id) ?? null : null), [subjects]);
  const subjectName = useCallback((id: string | null) => subjectById(id)?.name ?? null, [subjectById]);

  // ---- saving rounds ------------------------------------------------------------------
  const flush = useCallback(async () => {
    if (flushing.current) return;
    flushing.current = true;
    try {
      const out = await flushQueue(storage(), saveLog);
      if (out.saved.length) setSaved((cur) => [...cur, ...out.saved]);
      setQueue(out.pending);
    } finally {
      flushing.current = false;
    }
  }, []);

  const logRound = useCallback((log: SessionLog | null) => {
    if (!log) return;
    setQueue(enqueue(storage(), log));
    void flush();
  }, [flush]);

  // ---- starting and ending ----------------------------------------------------------------
  const ids = useMemo(() => new Set(subjects.map((s) => s.id)), [subjects]);
  const defaultId = defaultSubjectId({ pathname, lastUsed, subjectIds: ids });
  const pickedId = picked && picked.path === pathname && (picked.id === null || ids.has(picked.id)) ? picked.id : undefined;
  const subjectId = isActive(state) ? (state.subjectId && ids.has(state.subjectId) ? state.subjectId : null) : pickedId !== undefined ? pickedId : defaultId;

  const rememberSubject = useCallback((id: string | null) => {
    setLastUsed(id);
    try { storage().setItem(LAST_SUBJECT_KEY, id ?? ""); } catch {}
  }, []);

  const startPhase = useCallback((phase: Phase, opts: { subjectId?: string | null } = {}) => {
    const cur = stateRef.current;
    const p = prefsRef.current;
    const sid = opts.subjectId !== undefined ? opts.subjectId : subjectId;
    const at = Date.now();
    const next = start(cur, { phase, subjectId: sid, plannedSec: plannedFor(phase, p), now: at, sessionId: crypto.randomUUID() });
    apply(next);
    rememberSubject(sid);
    setPicked(null);
    announce(copy.startAnnouncement(phase, next.plannedSec, phase === "focus" ? subjectName(sid) : null, p.focusQuiet));
  }, [apply, announce, rememberSubject, subjectId, subjectName]);

  const startRef = useRef(startPhase);
  useEffect(() => { startRef.current = startPhase; }, [startPhase]);

  const showNotification = useCallback(async (ended: Ended) => {
    if (document.visibilityState !== "hidden" || notifyState() !== "granted") return;
    if (storage().getItem(NOTIFY_KEY) !== "on") return;
    const text = copy.notificationText({ phase: ended.ended.phase, nextMin: Math.round(plannedFor(ended.next, prefsRef.current) / 60) });
    const opts: NotificationOptions = { body: text.body, tag: "studynest-timer", silent: !soundOnRef.current, icon: "/icon.svg", data: { url: "/timer" } };
    try {
      const reg = await swRegistration();
      if (reg) await reg.showNotification(text.title, opts);
      else new Notification(text.title, opts);
    } catch {}
  }, []);

  /** This tab noticed the end of `sessionId`: claim it (once across tabs), then chime, notify and log. */
  const handleEnd = useCallback(async (sessionId: string) => {
    const claim = () => claimEnd(storage(), sessionId, tabId.current, Date.now(), prefsRef.current);
    let res: ReturnType<typeof claim> = null;
    try {
      res = navigator.locks ? await navigator.locks.request("studynest-timer-end", claim) : claim();
    } catch {
      res = claim();
    }
    if (!res) {
      // Another tab handled it (or the timer changed meanwhile): show what's stored.
      const stored = readTimer(storage());
      if (stored) apply(stored, false);
      return;
    }
    apply(res.state, false);
    logRound(res.log);
    const p = prefsRef.current;
    if (res.state.ended.phase === "focus") {
      try { storage().setItem(NUDGE_READY_KEY, "1"); } catch {}
      setNudgeReady(true);
    }
    const nextMin = Math.round(plannedFor(res.state.next, p) / 60);
    if (!res.late) play("chime");
    if (document.visibilityState === "hidden") setUnseenEnd(true);
    void showNotification(res.state);
    announce(res.late ? copy.awayLine(res.state.ended.phase, res.state.ended.endedAt, timezone) : copy.endAnnouncement({ phase: res.state.ended.phase, next: res.state.next, nextMin }));
    // Auto-start: the next phase starts by itself (only the chime plays). Not after a late wake.
    if (p.autoStart && !res.late) startRef.current(res.state.next, { subjectId: res.state.ended.subjectId });
  }, [apply, logRound, play, showNotification, announce, timezone]);

  // ---- mount: read this browser's timer, queue and settings ------------------------------
  useEffect(() => {
    tabId.current = crypto.randomUUID();
    const kv = storage();
    const stored = readTimer(kv);
    // localStorage only exists in the browser, so the stored timer is read after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (stored) apply(stored, false);
    setQueue(readQueue(kv));
    setLastUsed(kv.getItem(LAST_SUBJECT_KEY) || null);
    setNotify(notifyState());
    setNotifyOn(kv.getItem(NOTIFY_KEY) === "on");
    setNudgeReady(kv.getItem(NUDGE_READY_KEY) === "1");
    setNudgeSnoozed(Number(kv.getItem(NUDGE_KEY) ?? 0) > Date.now());
    setHydrated(true);
    void flush();
    if (kv.getItem(NOTIFY_KEY) === "on" && notifyState() === "granted") void swRegistration();
  }, [apply, flush]);

  // Other tabs: the timer and the queue follow localStorage.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === TIMER_KEY) apply(parseTimer(e.newValue) ?? IDLE, false);
      else if (e.key === QUEUE_KEY) setQueue(readQueue(storage()));
      else if (e.key === NOTIFY_KEY) setNotifyOn(e.newValue === "on");
    };
    const onOnline = () => void flush();
    window.addEventListener("storage", onStorage);
    window.addEventListener("online", onOnline);
    return () => { window.removeEventListener("storage", onStorage); window.removeEventListener("online", onOnline); };
  }, [apply, flush]);

  // A notification click (service worker) opens the panel.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === "studynest:open-timer") setPanelOpen(true); };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, []);

  // End detection: one timeout for the end, re-armed whenever the page wakes up. Browsers
  // throttle chained timers in hidden tabs to about once a minute; a single timeout isn't.
  const runningId = state.status === "running" ? state.sessionId : null;
  const endsAt = state.status === "running" ? state.endsAt : 0;
  useEffect(() => {
    if (!runningId) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(t);
      const left = endsAt - Date.now();
      if (left <= 0) void handleEnd(runningId);
      else t = setTimeout(() => void handleEnd(runningId), Math.min(left, 2 ** 31 - 1));
    };
    arm();
    const wake = () => {
      if (document.visibilityState === "hidden") return;
      setNow(Date.now());
      arm();
    };
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("pageshow", wake);
    window.addEventListener("focus", wake);
    return () => {
      clearTimeout(t);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("pageshow", wake);
      window.removeEventListener("focus", wake);
    };
  }, [runningId, endsAt, handleEnd]);

  // Redraw while running (only when the shown second changes), "1 minute left" once.
  useEffect(() => {
    if (state.status !== "running") return;
    let last = displaySec(remainingMs(state, Date.now(), prefsRef.current));
    const id = setInterval(() => {
      const t = Date.now();
      const sec = displaySec(remainingMs(state, t, prefsRef.current));
      if (sec === last) return;
      if (last > 60 && sec <= 60 && sec > 0) announce(copy.ONE_MINUTE);
      last = sec;
      setNow(t);
    }, 250);
    return () => clearInterval(id);
  }, [state, announce]);

  // Back on the tab: the "Time's up!" title has done its job.
  useEffect(() => {
    const seen = () => { if (document.visibilityState === "visible") { setUnseenEnd(false); setNotify(notifyState()); } };
    document.addEventListener("visibilitychange", seen);
    return () => document.removeEventListener("visibilitychange", seen);
  }, []);

  // Focus mode: on while a focus round runs or is paused (and the setting is on).
  const focusOn = prefs.focusQuiet && isActive(state) && state.phase === "focus";
  useEffect(() => {
    setFocusMode(focusOn);
    document.documentElement.toggleAttribute("data-focus-mode", focusOn);
  }, [focusOn, setFocusMode]);
  useEffect(() => () => { setFocusMode(false); document.documentElement.removeAttribute("data-focus-mode"); }, [setFocusMode]);

  // Tab title: "18:42 · Focus · StudyNest" while running, the page's own title otherwise.
  const chip = chipView(state, now, prefs, subjectName);
  const title = hydrated ? copy.tabTitle(chip, unseenEnd) : null;
  const ours = useRef<string | null>(null);
  const base = useRef("");
  const titleRef = useRef(title);
  useEffect(() => {
    const applyTitle = () => {
      const want = titleRef.current;
      if (want) {
        if (document.title !== want) { ours.current = want; document.title = want; }
      } else if (ours.current !== null) {
        if (document.title === ours.current) document.title = base.current;
        ours.current = null;
      }
    };
    base.current = document.title;
    // Next sets the page title on navigation; remember it as the one to put back.
    const obs = new MutationObserver(() => {
      if (document.title !== ours.current) { base.current = document.title; applyTitle(); }
    });
    obs.observe(document.head, { subtree: true, childList: true, characterData: true });
    const id = setInterval(applyTitle, 1000);
    return () => { obs.disconnect(); clearInterval(id); };
  }, []);
  useEffect(() => {
    titleRef.current = title;
    const want = title;
    if (want) {
      if (document.title !== want) { ours.current = want; document.title = want; }
    } else if (ours.current !== null) {
      if (document.title === ours.current) document.title = base.current;
      ours.current = null;
    }
  }, [title]);

  // ---- controls -----------------------------------------------------------------------
  const pauseTimer = useCallback(() => {
    const cur = stateRef.current;
    if (cur.status !== "running") return;
    const next = pause(cur, Date.now());
    apply(next);
    announce(copy.pauseAnnouncement(displaySec(next.remainingMs)));
  }, [apply, announce]);

  const resumeTimer = useCallback(() => {
    const cur = stateRef.current;
    if (cur.status !== "paused") return;
    const next = resume(cur, Date.now());
    apply(next);
    announce(copy.resumeAnnouncement(displaySec(cur.remainingMs)));
  }, [apply, announce]);

  const addFiveMin = useCallback(() => {
    const cur = stateRef.current;
    if (isActive(cur)) apply(addFive(cur));
  }, [apply]);

  const stopTimer = useCallback(() => {
    const cur = stateRef.current;
    if (!isActive(cur)) return;
    const out = stop(cur, Date.now());
    apply(out.state);
    logRound(out.log ? { ...out.log, subjectId: cur.subjectId && ids.has(cur.subjectId) ? cur.subjectId : null } : null);
  }, [apply, logRound, ids]);

  const endCardChoice = useCallback((choice: "skip_break" | "done") => {
    const cur = stateRef.current;
    if (cur.status === "ended") apply(afterEnd(cur, choice));
  }, [apply]);

  const choosePhase = useCallback((phase: Phase) => {
    const cur = stateRef.current;
    if (cur.status === "idle") apply(selectPhase(cur, phase));
    else if (cur.status === "ended") apply(selectPhase(afterEnd(cur, "skip_break"), phase));
  }, [apply]);

  const chooseSubject = useCallback((id: string | null) => {
    const cur = stateRef.current;
    if (isActive(cur)) {
      apply(setSubject(cur, id));
      rememberSubject(id);
    } else {
      setPicked({ path: pathname, id });
    }
  }, [apply, rememberSubject, pathname]);

  const setPrefs = useCallback(async (patch: Partial<TimerPrefs>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefsState(next);
    try {
      const res = await updateSettings({
        timerFocusMin: patch.focusMin, timerShortMin: patch.shortMin, timerLongMin: patch.longMin, timerLongEvery: patch.longEvery,
        timerAutoStart: patch.autoStart, focusQuiet: patch.focusQuiet,
      });
      return res.ok;
    } catch {
      return false;
    }
  }, []);

  // ---- notifications ------------------------------------------------------------------
  const setNotifyEnabled = useCallback(async (on: boolean) => {
    const kv = storage();
    if (!on) {
      kv.setItem(NOTIFY_KEY, "off");
      setNotifyOn(false);
      return;
    }
    if (!("Notification" in window)) return;
    // Asked only from this click (never on page load).
    const perm = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission;
    setNotify(perm);
    const granted = perm === "granted";
    kv.setItem(NOTIFY_KEY, granted ? "on" : "off");
    setNotifyOn(granted);
    if (granted) void swRegistration();
  }, []);

  const dismissNudge = useCallback(() => {
    try { storage().setItem(NUDGE_KEY, String(Date.now() + NUDGE_SNOOZE_MS)); } catch {}
    setNudgeSnoozed(true);
  }, []);

  // ---- tally --------------------------------------------------------------------------
  const sessions = useMemo(() => {
    const local = [...saved.map(toTally), ...queue.map((q) => toTally(q.log))];
    return serverSessions ? mergeSessions(serverSessions, local) : local.length ? mergeSessions(local) : null;
  }, [serverSessions, saved, queue]);
  const tally = useMemo(() => todayTally(sessions ?? [], timezone, new Date(now)), [sessions, timezone, now]);

  const openPanel = useCallback(() => setPanelOpen(true), []);
  const closePanel = useCallback(() => {
    setPanelOpen(false);
    chipRef.current?.focus();
  }, []);
  // Full screen (`/timer`) replaces the panel.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (pathname === "/timer") setPanelOpen(false);
  }, [pathname]);

  const value: Ctx = {
    hydrated, state, now, prefs, setPrefs, subjects, subjectById, subjectId, chooseSubject,
    startPhase: (phase, opts) => startPhase(phase, opts), pauseTimer, resumeTimer, addFiveMin, stopTimer, endCardChoice, choosePhase,
    tally, sessions, timezone,
    queued: queue.length, stuck: queue.filter((q) => q.tries >= STUCK_TRIES).length,
    panelOpen, openPanel, closePanel, chipRef,
    notify: {
      state: notify,
      enabled: notifyOn && notify === "granted",
      setEnabled: setNotifyEnabled,
      nudge: hydrated && notify === "default" && nudgeReady && !nudgeSnoozed && !notifyOn,
      dismissNudge,
    },
  };

  return (
    <TimerContext value={value}>
      {children}
      <TimerPanel />
      <div aria-live="polite" role="status" className="sr-only" data-testid="timer-live">{announcement}</div>
    </TimerContext>
  );
}

/** What the chip shows (and the tab title follows). */
export function chipView(state: TimerState, now: number, prefs: TimerPrefs, name: (id: string | null) => string | null): copy.ChipView {
  if (state.status === "ended") return { kind: "ended", phase: state.ended.phase };
  if (!isActive(state)) return { kind: "idle" };
  return { kind: state.status, phase: state.phase, sec: displaySec(remainingMs(state, now, prefs)), subject: name(state.subjectId) };
}
