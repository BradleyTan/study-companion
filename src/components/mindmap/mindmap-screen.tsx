"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { Quota } from "@/lib/limits/ai";
import { madeFromLine, retryDelay } from "@/lib/mindmap/view";
import { timeAgo } from "@/lib/time";
import type { SubjectColour } from "@/lib/subjects";
import { makeMindmap, resetMindmapLayout, saveMindmapPositions, type MindmapResult } from "@/server/actions/mindmap";
import type { MindmapView } from "@/server/mindmap";
import type { MindmapSources } from "@/server/repo/types";
import { NoSources } from "../no-sources";
import { useSound } from "../sound-provider";
import { SubjectChip } from "../subject-chip";
import { useActionToast } from "../ui/action-toast";
import { Button } from "../ui/button";
import { Dialog } from "../ui/dialog";
import { QuotaChip } from "../ui/quota-chip";
import { RowMenu } from "../ui/row-menu";
import { subjectStyle } from "../ui/subject-style";
import { MindmapCanvas } from "./mindmap-canvas";
import { MindmapOutline } from "./outline";
import { PassagePanel, type PanelNode } from "./passage-panel";

export type SourceOption = { id: string; kind: "note" | "file"; title: string; chars: number };
type Problem = Exclude<MindmapResult["status"], "made">;
type Save = "idle" | "saving" | "saved" | "error";

const VIEW_KEY = "studynest.mindmapView";
const HINT_KEY = "studynest.mindmapTouchHint";
const DETAILS_KEY = "studynest.mindmapDetails";
const LINES = ["Reading your notes…", "Finding the big ideas…", "Drawing branches…"];

const MESSAGES: Record<Problem, string> = {
  too_short: "There isn't enough in your notes for a mindmap yet. Add a bit more and try again.",
  too_long: "That's a lot of reading! Untick a few so the map stays clear.",
  limit: "", // depends on the limit; see limitText
  allowance: "Today's free AI allowance is used up. Try again tomorrow. Your notes are safe.",
  failed: "The map maker got tangled up. Try again. This one didn't use up a go.",
  not_configured: "AI isn't set up yet, so mindmaps can't be made right now. Your notes are safe.",
};
const limitText = (q: Quota) => `You've made ${q.limit} mindmaps today. More tomorrow! Your current map is still here.`;

/** The mindmap screen (docs/design/screens/mindmap.md). */
export function MindmapScreen({ subject, initial, quota: initialQuota, options, maxChars }: {
  subject: { id: string; name: string; colour: SubjectColour; emoji: string };
  initial: (MindmapView & { sources: MindmapSources }) | null;
  quota: Quota;
  options: SourceOption[];
  maxChars: number;
}) {
  const [view, setView] = useState(initial);
  const [quota, setQuota] = useState(initialQuota);
  const [mode, setMode] = useState<"map" | "outline">("map");
  const [details, setDetails] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initial && !initial.sources.all ? [...initial.sources.noteIds, ...initial.sources.sourceIds] : options.map((o) => o.id)));
  const [panel, setPanel] = useState<PanelNode | null>(null);
  const [animate, setAnimate] = useState(false);
  const [layoutKey, setLayoutKey] = useState(0);
  const [save, setSave] = useState<Save>("idle");
  // A map made somewhere else (another tab) arrives with a refresh: show it from the start. The map
  // this screen has just made comes back with the same createdAt, so a refresh landing late never
  // resets the screen under the student (an open passage, a layout save on its way; QA step 3).
  const serverAt = initial?.createdAt ?? null;
  const [shownAt, setShownAt] = useState(serverAt);
  if (serverAt !== shownAt) {
    setShownAt(serverAt);
    if (serverAt && serverAt !== view?.createdAt) {
      setView(initial);
      setPanel(null);
      setAnimate(false);
      setLayoutKey((k) => k + 1);
      setSave("idle");
    }
  }
  const [hint, setHint] = useState(false);
  const [line, setLine] = useState(0);
  const [announce, setAnnounce] = useState("");
  const { play } = useSound();
  const toast = useActionToast();
  const router = useRouter();
  const mounted = useRef(true);
  const lastNode = useRef<string | null>(null);
  // Layout save state (see "saving positions" below).
  const pending = useRef<{ id: string; x: number; y: number }[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const uid = useId();

  useEffect(() => () => { mounted.current = false; }, []);

  // Remembered Map | Outline choice and the one-time touch hint.
  useEffect(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v === "outline" || v === "map") setMode(v);
      if (localStorage.getItem(DETAILS_KEY) === "off") setDetails(false);
      if (window.matchMedia("(pointer: coarse)").matches && !localStorage.getItem(HINT_KEY)) setHint(true);
    } catch {}
  }, []);

  useEffect(() => {
    if (!generating) return;
    const t = setInterval(() => setLine((l) => (l + 1) % LINES.length), 3000);
    return () => clearInterval(t);
  }, [generating]);

  const toggleDetails = () => {
    const next = !details;
    setDetails(next);
    try { localStorage.setItem(DETAILS_KEY, next ? "on" : "off"); } catch {}
    toast.show(next ? "Details shown on the map" : "Details hidden on the map");
  };

  const chooseMode = (m: "map" | "outline") => {
    play("click");
    setMode(m);
    try { localStorage.setItem(VIEW_KEY, m); } catch {}
  };

  // ---- generating ----
  const selection = (): MindmapSources => {
    const all = options.every((o) => selected.has(o.id));
    return {
      all,
      noteIds: all ? [] : options.filter((o) => o.kind === "note" && selected.has(o.id)).map((o) => o.id),
      sourceIds: all ? [] : options.filter((o) => o.kind === "file" && selected.has(o.id)).map((o) => o.id),
    };
  };

  async function generate(force: boolean) {
    // Drop any unsaved or retrying layout save: node ids (n0, n1, …) repeat in the new map.
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    setConfirm(false);
    setChoosing(false);
    setProblem(null);
    setPanel(null);
    setGenerating(true);
    setLine(0);
    setAnnounce("Making your mindmap. This takes about 20 seconds.");
    const res = await makeMindmap({ subjectId: subject.id, selection: selection(), force }).catch(() => null);
    setGenerating(false);
    setAnnounce("");
    if (!res || !res.ok) {
      play("boop");
      setProblem("failed");
      return;
    }
    const r = res.result;
    setQuota(r.quota);
    if (r.status !== "made") {
      play("boop");
      setProblem(r.status);
      return;
    }
    setView({ ...r.view, sources: selection() });
    setAnimate(true);
    setLayoutKey((k) => k + 1);
    setSave("idle");
    if (mounted.current) play("pop");
    router.refresh();
  }

  const onRegenerate = () => {
    if (quota.left === 0) { play("boop"); setProblem("limit"); return; }
    play("click");
    setConfirm(true);
  };

  // ---- saving positions (800 ms after the last move; retry with backoff) ----
  const attempt = useRef(0);
  const retry = useRef<() => void>(() => {});
  const flush = useCallback(async () => {
    const positions = pending.current;
    if (!positions) return;
    setSave("saving");
    const res = await saveMindmapPositions({ subjectId: subject.id, positions }).catch(() => null);
    if (pending.current !== positions) return; // moved again meanwhile; the newer save wins
    if (res?.ok) {
      pending.current = null;
      attempt.current = 0;
      setSave("saved");
      timer.current = setTimeout(() => setSave((s) => (s === "saved" ? "idle" : s)), 2000);
    } else {
      setSave("error");
      timer.current = setTimeout(() => retry.current(), retryDelay(attempt.current++));
    }
  }, [subject.id]);
  useEffect(() => { retry.current = () => void flush(); }, [flush]);
  const onMoved = useCallback((positions: { id: string; x: number; y: number }[]) => {
    pending.current = positions;
    attempt.current = 0;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), 800);
  }, [flush]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  async function resetLayout() {
    if (timer.current) clearTimeout(timer.current);
    pending.current = null;
    const res = await resetMindmapLayout(subject.id).catch(() => null);
    if (!res?.ok) { play("boop"); toast.show("Layout not reset. Try again."); return; }
    setView((v) => (v ? { ...v, graph: { ...v.graph, nodes: v.graph.nodes.map(({ position, ...n }) => { void position; return n; }) } } : v));
    setAnimate(false);
    setLayoutKey((k) => k + 1);
    setSave("idle");
    toast.show("Layout reset");
  }

  // ---- passage panel ----
  const openNode = useCallback((id: string) => {
    const n = view?.graph.nodes.find((x) => x.id === id);
    if (!n) return;
    play("click");
    lastNode.current = id;
    setPanel({ id: n.id, label: n.label, chunkId: n.chunkId, detail: n.detail ?? null });
  }, [view, play]);
  const closePanel = () => {
    setPanel(null);
    const id = lastNode.current;
    if (!id) return;
    requestAnimationFrame(() => {
      const el = mode === "map"
        ? document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
        : document.querySelector<HTMLElement>(`[data-outline-node="${id}"]`);
      el?.focus();
    });
  };

  // ---- choose sources ----
  const chosenChars = useMemo(() => options.filter((o) => selected.has(o.id)).reduce((n, o) => n + o.chars, 0), [options, selected]);
  const allChosen = options.every((o) => selected.has(o.id));
  const tooLong = !allChosen && chosenChars > maxChars;

  // ---- rendering ----
  const nothingToMap = options.length === 0;
  const saveLabel = { idle: "", saving: "Saving…", saved: "Saved ✓", error: "Layout not saved. Retrying…" }[save];
  const problemText = problem === "limit" ? limitText(quota) : problem ? MESSAGES[problem] : "";
  const limitId = `${uid}-limit`;

  const generatingArt = (
    <div className="flex flex-col items-center gap-4 p-6 text-center" data-testid="mindmap-generating">
      <svg aria-hidden="true" width="220" height="120" viewBox="0 0 220 120" className="overflow-visible">
        {[[110, 60, 20, 10], [110, 60, 200, 10], [110, 60, 20, 110], [110, 60, 200, 110]].map(([x1, y1, x2, y2], i) => (
          <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink)" strokeWidth="2" className="draw-branch" style={{ animationDelay: `${i * 0.4}s` }} />
        ))}
      </svg>
      <div className="mm-node mm-root -mt-24 mb-12"><span aria-hidden="true">{subject.emoji} </span>{subject.name}</div>
      <p className="font-bold" aria-hidden="true">{LINES[line]}</p>
    </div>
  );

  return (
    <div className="flex flex-col gap-4" style={subjectStyle(subject.colour)}>
      <p className="sr-only" role="status" aria-live="polite">{announce}</p>
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={`/subjects/${subject.id}`} className="inline-flex min-h-11 items-center font-bold underline-offset-4 hover:underline [overflow-wrap:anywhere]" onClick={() => play("click")}>← {subject.name}</Link>
          <SubjectChip name={subject.name} emoji={subject.emoji} colour={subject.colour} />
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="font-display text-3xl sm:text-4xl">Mindmap</h1>
            {view && (
              <p className="hint" data-testid="mindmap-meta">
                {madeFromLine(view.madeFrom.notes, view.madeFrom.files)} · {timeAgo(view.createdAt)}
                {saveLabel && <span className="chip ml-2" role="status" data-testid="layout-save">{saveLabel}</span>}
              </p>
            )}
          </div>
          {view && (
            <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
              <div className="seg" role="group" aria-label="View">
                <button type="button" aria-pressed={mode === "map"} onClick={() => chooseMode("map")}>Map</button>
                <button type="button" aria-pressed={mode === "outline"} onClick={() => chooseMode("outline")}>Outline</button>
              </div>
              <span className="ml-auto flex items-center gap-2 sm:ml-0">
                <Button
                  size="sm" sound={null} className="min-h-11" disabled={generating}
                  aria-disabled={quota.left === 0 || undefined} aria-describedby={quota.left === 0 ? limitId : undefined}
                  onClick={onRegenerate}
                >
                  <span aria-hidden="true">↻ </span><span className="sm:hidden">New map</span><span className="hidden sm:inline">Regenerate</span>
                </Button>
                {/* The quota chip sits straight after the button it limits (polish.md P2-4). */}
                <span className="hidden sm:inline-flex"><QuotaChip quota={quota} /></span>
                <RowMenu
                  label="More mindmap actions"
                  items={[
                    ...(view.graph.nodes.some((n) => n.detail) && mode === "map" ? [{ label: details ? "Hide details on map" : "Show details on map", onSelect: toggleDetails }] : []),
                    { label: "Reset layout", onSelect: () => void resetLayout() },
                    { label: "Choose sources", onSelect: () => setChoosing(true) },
                  ]}
                />
              </span>
              {quota.left === 0 && <span id={limitId} className="sr-only">{limitText(quota)}</span>}
            </div>
          )}
          {/* mindmap.md "375 px phone specifics": offer Outline prominently (polish.md P2-9). */}
          {view && mode === "map" && <p className="hint w-full sm:hidden" data-testid="outline-tip">Tip: Outline is easier to read on a phone.</p>}
        </div>
      </header>

      {problem && (
        <div role="alert" className="sticker-flat flex flex-wrap items-center gap-3 p-3" data-testid="mindmap-problem">
          <p className="min-w-0 flex-1 font-bold">{problemText}</p>
          {problem === "failed" && <Button size="sm" onClick={() => void generate(!!view)}>Try again</Button>}
          {problem === "too_short" && <Link className="btn btn-sm [overflow-wrap:anywhere]" href={`/subjects/${subject.id}`} onClick={() => play("click")}>Back to {subject.name}</Link>}
          {problem === "too_long" && <Button size="sm" onClick={() => setChoosing(true)}>Choose sources</Button>}
        </div>
      )}

      {view?.changed && !generating && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border-2 border-ink bg-highlight px-3 py-2 text-[var(--on-colour)]" role="status">
          <span className="min-w-0 flex-1 font-bold">Your notes changed since this map was made. Tap ↻ above to update it.</span>
        </div>
      )}

      {!view && !generating && nothingToMap ? (
        <NoSources subjectId={subject.id} title="Nothing to map yet" then="map it" testId="mindmap-no-sources" />
      ) : !view ? (
        <div className="mindmap-frame flex items-center justify-center">
          {generating ? generatingArt : (
            <div className="flex flex-col items-center gap-4 p-6 text-center">
              <div className="mm-node mm-root border-dashed"><span role="img" aria-label={subject.name}>{subject.emoji}</span></div>
              <p className="font-display text-2xl">No mindmap yet</p>
              <p>We&apos;ll turn your notes into a map of the big ideas, with the key facts under each one.</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button variant="primary" sound={null}
                  aria-disabled={quota.left === 0 || undefined}
                  onClick={() => { if (quota.left === 0) { play("boop"); setProblem("limit"); return; } play("click"); void generate(false); }}>
                  Make a mindmap
                </Button>
                <QuotaChip quota={quota} />
              </div>
              <button type="button" className="font-bold underline underline-offset-2" onClick={() => { play("click"); setChoosing(true); }}>Choose sources</button>
            </div>
          )}
        </div>
      ) : mode === "outline" ? (
        <div className={generating ? "mm-dim" : ""} inert={generating}>
          {generating && generatingArt}
          <MindmapOutline graph={view.graph} emoji={subject.emoji} onOpen={openNode} />
        </div>
      ) : (
        <div className="mindmap-frame">
          <div className={`h-full ${generating ? "mm-dim" : ""}`} inert={generating}>
            <MindmapCanvas
              graph={view.graph} subjectName={subject.name} emoji={subject.emoji}
              animate={animate} layoutKey={layoutKey} details={details} onOpen={openNode} onMoved={onMoved}
            />
          </div>
          {generating && <div className="absolute inset-0 flex items-center justify-center">{generatingArt}</div>}
          {hint && !generating && (
            <div className="sticker absolute left-3 right-3 top-3 z-10 flex flex-wrap items-center gap-3 p-3 sm:left-auto sm:max-w-sm" role="note">
              <p className="min-w-0 flex-1">Pinch to zoom, drag to move around, tap a topic to see its notes.</p>
              <Button size="sm" onClick={() => { setHint(false); try { localStorage.setItem(HINT_KEY, "1"); } catch {} }}>Got it</Button>
            </div>
          )}
        </div>
      )}

      <PassagePanel node={panel} onClose={closePanel} />

      <Dialog open={confirm} onClose={() => setConfirm(false)} title="Make a new map?">
        <p>
          {view?.changed
            ? `Make a new map from your latest notes? Moved topics will go back to their places. Uses 1 of today's ${quota.limit}.`
            : `Your notes haven't changed. Make a fresh version anyway? Uses 1 of today's ${quota.limit}.`}
        </p>
        <QuotaChip quota={quota} />
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
          <Button variant="primary" sound={null} onClick={() => void generate(!view?.changed)}>Make new map</Button>
        </div>
      </Dialog>

      <Dialog open={choosing} onClose={() => setChoosing(false)} title="Choose sources">
        <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); if (!tooLong && selected.size) void generate(true); }}>
          <fieldset className="flex flex-col gap-1">
            <legend className="label mb-1">Map these notes and files</legend>
            {options.length === 0 && <p className="hint">Add a note or a lecture file first, then we can map it.</p>}
            {options.map((o) => (
              <label key={o.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-[var(--paper)]">
                <input type="checkbox" className="h-5 w-5 accent-[var(--ink)]" checked={selected.has(o.id)}
                  onChange={() => { play("click"); setSelected((s) => { const n = new Set(s); if (n.has(o.id)) n.delete(o.id); else n.add(o.id); return n; }); }} />
                <span aria-hidden="true">{o.kind === "note" ? "📝" : "📄"}</span>
                <span className="min-w-0 flex-1 truncate font-bold">{o.title}</span>
              </label>
            ))}
          </fieldset>
          {tooLong && <p className="hint" role="status" id={`${uid}-long`}>That&apos;s a lot of reading! Untick a few so the map stays clear.</p>}
          {allChosen && chosenChars > maxChars && <p className="hint">That&apos;s a lot of reading, so the map covers all of it evenly.</p>}
          <QuotaChip quota={quota} />
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" onClick={() => setChoosing(false)}>Cancel</Button>
            <Button type="submit" variant="primary" sound={null} disabled={tooLong || selected.size === 0 || quota.left === 0}
              aria-describedby={tooLong ? `${uid}-long` : undefined}>
              Make map from these
            </Button>
          </div>
        </form>
      </Dialog>
      {toast.node}
    </div>
  );
}
