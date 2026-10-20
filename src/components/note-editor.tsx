"use client";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { splitSentences } from "@/lib/speech/sentences";
import { SUBJECT_COLOURS, type SubjectColour } from "@/lib/subjects";
import { findLoose, findPassage } from "@/lib/text/find";
import { deleteNote, saveNote } from "@/server/actions/notes";
import { flatten, highlightKey, Highlights } from "./editor/highlights";
import { MakeFlashcardsDialog } from "./flashcards/make-dialog";
import { SpeakerIcon } from "./read-aloud/read-aloud-button";
import { ReadAloudBar } from "./read-aloud/read-aloud-bar";
import { speech, useSpeechState, type Segment } from "./read-aloud/speech";
import { useSound } from "./sound-provider";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";
import { subjectStyle } from "./ui/subject-style";

type SaveState = "saved" | "dirty" | "saving" | "error";
const DEBOUNCE_MS = 800;

/** Passage to mark when the page is opened from a card or mindmap node (?quote= / ?card=). */
export type PassageTarget = { text: string | null; quote: string | null };

export function NoteEditor(props: {
  note: { id: string; title: string; contentJson: Record<string, unknown> };
  subject: { id: string; name: string; emoji: string; colour: SubjectColour };
  passage?: PassageTarget | null;
}) {
  const { note, subject, passage } = props;
  const { play } = useSound();
  const [readOpen, setReadOpen] = useState(false);
  const [making, setMaking] = useState(false);
  const [everMade, setEverMade] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [passageMissing, setPassageMissing] = useState(false);
  const speechOwner = `note:${note.id}`;
  const speechState = useSpeechState();
  const segmentsRef = useRef<{ seg: Segment; from: number; to: number }[]>([]);
  const [title, setTitle] = useState(note.title);
  const [state, setState] = useState<SaveState>("saved");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, startDelete] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retries = useRef(0);
  const titleRef = useRef(note.title);
  const editorRef = useRef<Editor | null>(null);

  // These only touch refs and state setters, so the editor's first-render closure stays correct.
  function schedule() {
    setState("dirty");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), DEBOUNCE_MS);
  }

  async function save(): Promise<boolean> {
    const ed = editorRef.current;
    if (!ed) return false;
    setState("saving");
    const res = await saveNote({ id: note.id, title: titleRef.current, contentJson: ed.getJSON(), contentText: ed.getText({ blockSeparator: "\n\n" }) }).catch(() => null);
    if (res?.ok) {
      retries.current = 0;
      setErrorMsg(null);
      setState((s) => (s === "saving" ? "saved" : s));
      return true;
    }
    setState("error");
    setErrorMsg(res && !res.ok ? res.error : null);
    // Network or server hiccup: retry with backoff. A validation error (too long) needs the student to act.
    if (!res) {
      const wait = Math.min(30_000, 2000 * 2 ** retries.current++);
      timer.current = setTimeout(() => void save(), wait);
    }
    return false;
  }

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false }), Placeholder.configure({ placeholder: "Start typing your notes…" }), Highlights],
    content: note.contentJson,
    immediatelyRender: false,
    editorProps: { attributes: { class: "tiptap", "aria-label": "Note text", role: "textbox", "aria-multiline": "true" } },
    onUpdate: () => {
      // Typing while reading stops reading.
      speech.stopIf(speechOwner, "Stopped because you edited the note");
      schedule();
    },
  });
  useEffect(() => { editorRef.current = editor; }, [editor]);

  // Mark the passage a card or mindmap node came from, then fade it after 4 s
  // (with reduced motion it stays until the first keypress).
  useEffect(() => {
    if (!editor || !passage) return;
    const flat = flatten(editor.state.doc);
    // The card's quote first, then the passage it came from.
    let range = passage.quote ? findLoose(flat.text, passage.quote) : null;
    if (!range && passage.text) range = findPassage(flat.text, passage.text);
    if (!range) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPassageMissing(true);
      return;
    }
    const from = flat.toPos(range.start);
    const to = flat.toPos(range.end);
    editor.view.dispatch(editor.state.tr.setMeta(highlightKey, { passage: { from, to } }));
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    requestAnimationFrame(() => {
      const el = editor.view.dom.querySelector("[data-testid=passage-mark]");
      el?.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
    });
    const clear = () => { if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(highlightKey, { passage: null })); };
    const t = reduced ? null : setTimeout(clear, 4000);
    const onKey = () => { clear(); window.removeEventListener("keydown", onKey); };
    if (reduced) window.addEventListener("keydown", onKey);
    return () => { if (t) clearTimeout(t); window.removeEventListener("keydown", onKey); };
  }, [editor, passage]);

  // Mark the sentence being read; scroll only when it leaves the viewport.
  useEffect(() => {
    if (!editor || editor.isDestroyed) return;
    const active = speechState.owner === speechOwner && (speechState.status === "playing" || speechState.status === "paused");
    const cur = active ? segmentsRef.current[speechState.index] : undefined;
    editor.view.dispatch(editor.state.tr.setMeta(highlightKey, { speaking: cur ? { from: cur.from, to: cur.to } : null }));
    if (cur) {
      const el = editor.view.dom.querySelector("[data-testid=speaking-mark]");
      const r = el?.getBoundingClientRect();
      if (el && r && (r.top < 120 || r.bottom > window.innerHeight)) {
        el.scrollIntoView({ block: "nearest", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      }
    }
  }, [editor, speechState, speechOwner]);
  useEffect(() => () => speech.stopIf(speechOwner), [speechOwner]);

  /** Sentences to read: the selection, else from the sentence at the cursor to the end. */
  function readSegments(fromTop: boolean): { segments: Segment[]; note?: string } {
    const ed = editorRef.current;
    if (!ed) return { segments: [] };
    const flat = flatten(ed.state.doc, true);
    const all = splitSentences(flat.text).map((seg) => ({ seg, from: flat.toPos(seg.start), to: flat.toPos(seg.end) }));
    const { from, to, empty } = ed.state.selection;
    let list = all;
    if (!fromTop && !empty) list = all.filter((x) => x.to > from && x.from < to);
    else if (!fromTop && ed.isFocused && from > 1) {
      const i = all.findIndex((x) => x.to >= from);
      list = i === -1 ? all : all.slice(i);
    }
    segmentsRef.current = list;
    return { segments: list.map((x) => x.seg), note: flat.skippedCode ? "Reading (code skipped)" : undefined };
  }

  async function openMake() {
    if (state !== "saved") {
      if (timer.current) clearTimeout(timer.current);
      setPreparing(true);
      await save();
      setPreparing(false);
    }
    setEverMade(true);
    setMaking(true);
  }

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => { if (state !== "saved") e.preventDefault(); };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [state]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const label = { saved: "Saved ✓", dirty: "Editing…", saving: "Saving…", error: "Not saved. Retrying…" }[state];

  return (
    <div className="flex flex-col gap-4" style={subjectStyle(subject.colour)}>
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/subjects/${subject.id}`} className="inline-flex min-h-11 items-center font-bold underline-offset-4 hover:underline" onClick={() => play("click")}>← {subject.name}</Link>
        <span className="chip on-colour" style={{ background: SUBJECT_COLOURS[subject.colour] }}>{subject.emoji} {subject.name}</span>
        <Button size="sm" className="order-last w-full sm:order-none sm:w-auto" disabled={preparing} onClick={() => void openMake()}>
          <span aria-hidden="true">🗂️</span> {preparing ? "Saving your note first…" : "Make flashcards"}
        </Button>
        <span
          role="status" data-testid="save-state"
          className={`chip ml-auto ${state === "saved" ? "bg-highlight on-colour" : state === "error" ? "chip-bad" : ""}`}
        >
          {label}
        </span>
      </div>
      {state === "error" && errorMsg && <p role="alert" className="error-text">{errorMsg}</p>}
      {passageMissing && (
        <div role="status" className="sticker-flat flex flex-col gap-2 bg-highlight p-3 text-[var(--on-colour)]">
          <p className="font-bold">This passage has changed since the card was made.</p>
          {passage?.quote && <blockquote className="border-l-4 border-ink pl-3 italic">{passage.quote}</blockquote>}
        </div>
      )}
      <label htmlFor="note-title" className="sr-only">Title</label>
      <input
        id="note-title" value={title} maxLength={200} placeholder="Untitled note"
        onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; schedule(); }}
        className="min-h-11 w-full rounded-md border-2 border-transparent bg-transparent px-1 text-3xl font-bold focus:border-ink focus:bg-card"
      />
      <Toolbar editor={editor} readOpen={readOpen} onRead={() => setReadOpen((o) => { if (o) speech.stopIf(speechOwner); return !o; })} />
      {readOpen && (
        <ReadAloudBar
          owner={speechOwner}
          empty={!editor || editor.isEmpty}
          getSegments={readSegments}
          onClose={() => { setReadOpen(false); requestAnimationFrame(() => document.getElementById("read-aloud-btn")?.focus()); }}
        />
      )}
      <div className="paper-sheet px-4 py-3 sm:px-8 sm:py-5" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} />
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>Delete note</Button>
      </div>
      {everMade && (
        <MakeFlashcardsDialog subjectId={subject.id} subjectName={subject.name} open={making} onClose={() => setMaking(false)} preset={{ type: "note", id: note.id }} />
      )}
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this note?">
        <p>&ldquo;{title || "Untitled note"}&rdquo; will be gone for good. Flashcards and quizzes made from it stay, with their quotes.</p>
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>Keep it</Button>
          <Button variant="danger" sound="tear" disabled={deleting} onClick={() => startDelete(async () => { if (timer.current) clearTimeout(timer.current); await deleteNote(note.id); })}>
            Delete note
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function Toolbar({ editor, readOpen, onRead }: { editor: Editor | null; readOpen: boolean; onRead: () => void }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      bold: e?.isActive("bold") ?? false,
      italic: e?.isActive("italic") ?? false,
      h2: e?.isActive("heading", { level: 2 }) ?? false,
      bullet: e?.isActive("bulletList") ?? false,
      ordered: e?.isActive("orderedList") ?? false,
      quote: e?.isActive("blockquote") ?? false,
      code: e?.isActive("codeBlock") ?? false,
      canUndo: e?.can().undo() ?? false,
      canRedo: e?.can().redo() ?? false,
    }),
  });
  if (!editor || !s) return <div className="h-12" />;
  const c = () => editor.chain().focus();
  const tools: { label: string; text: string; active?: boolean; run: () => void; disabled?: boolean }[] = [
    { label: "Bold", text: "B", active: s.bold, run: () => c().toggleBold().run() },
    { label: "Italic", text: "I", active: s.italic, run: () => c().toggleItalic().run() },
    { label: "Heading", text: "H", active: s.h2, run: () => c().toggleHeading({ level: 2 }).run() },
    { label: "Bullet list", text: "•", active: s.bullet, run: () => c().toggleBulletList().run() },
    { label: "Numbered list", text: "1.", active: s.ordered, run: () => c().toggleOrderedList().run() },
    { label: "Quote", text: "❝", active: s.quote, run: () => c().toggleBlockquote().run() },
    { label: "Code", text: "</>", active: s.code, run: () => c().toggleCodeBlock().run() },
    { label: "Undo", text: "↶", run: () => c().undo().run(), disabled: !s.canUndo },
    { label: "Redo", text: "↷", run: () => c().redo().run(), disabled: !s.canRedo },
  ];
  return (
    <div role="toolbar" aria-label="Formatting" className="sticky top-[calc(env(safe-area-inset-top,0px)+58px)] z-20 flex flex-wrap gap-1.5 rounded-lg border-[2.5px] border-ink bg-card p-1.5">
      {tools.map((t) => (
        <Button
          key={t.label} size="sm" className={`icon-btn ${t.label === "Bold" ? "font-black" : t.label === "Italic" ? "italic" : ""}`}
          aria-label={t.label} title={t.label} disabled={t.disabled}
          {...(t.active !== undefined ? { "aria-pressed": t.active } : {})}
          onClick={t.run}
        >
          <span aria-hidden="true">{t.text}</span>
        </Button>
      ))}
      <span aria-hidden="true" className="mx-1 w-[2px] self-stretch bg-ink" />
      <Button id="read-aloud-btn" size="sm" className="icon-btn" aria-label="Read aloud" aria-expanded={readOpen} title="Read aloud (Alt+Shift+R)" onClick={onRead}>
        <SpeakerIcon /><span className="hidden sm:inline">Read aloud</span>
      </Button>
    </div>
  );
}
