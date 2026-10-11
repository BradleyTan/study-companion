"use client";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import Placeholder from "@tiptap/extension-placeholder";
import StarterKit from "@tiptap/starter-kit";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { SUBJECT_COLOURS, type SubjectColour } from "@/lib/subjects";
import { deleteNote, saveNote } from "@/server/actions/notes";
import { Button } from "./ui/button";
import { Dialog } from "./ui/dialog";

type SaveState = "saved" | "dirty" | "saving" | "error";
const DEBOUNCE_MS = 800;

export function NoteEditor(props: {
  note: { id: string; title: string; contentJson: Record<string, unknown> };
  subject: { id: string; name: string; emoji: string; colour: SubjectColour };
}) {
  const { note, subject } = props;
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

  async function save() {
    const ed = editorRef.current;
    if (!ed) return;
    setState("saving");
    const res = await saveNote({ id: note.id, title: titleRef.current, contentJson: ed.getJSON(), contentText: ed.getText({ blockSeparator: "\n\n" }) }).catch(() => null);
    if (res?.ok) {
      retries.current = 0;
      setErrorMsg(null);
      setState((s) => (s === "saving" ? "saved" : s));
      return;
    }
    setState("error");
    setErrorMsg(res && !res.ok ? res.error : null);
    // Network or server hiccup: retry with backoff. A validation error (too long) needs the student to act.
    if (!res) {
      const wait = Math.min(30_000, 2000 * 2 ** retries.current++);
      timer.current = setTimeout(() => void save(), wait);
    }
  }

  const editor = useEditor({
    extensions: [StarterKit.configure({ link: false }), Placeholder.configure({ placeholder: "Start typing your notes…" })],
    content: note.contentJson,
    immediatelyRender: false,
    editorProps: { attributes: { class: "tiptap", "aria-label": "Note text", role: "textbox", "aria-multiline": "true" } },
    onUpdate: () => schedule(),
  });
  useEffect(() => { editorRef.current = editor; }, [editor]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onLeave = (e: BeforeUnloadEvent) => { if (state !== "saved") e.preventDefault(); };
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [state]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const label = { saved: "Saved ✓", dirty: "Editing…", saving: "Saving…", error: "Not saved. Retrying…" }[state];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/subjects/${subject.id}`} className="font-bold underline-offset-4 hover:underline">← Back to {subject.name}</Link>
        <span className="chip on-colour" style={{ background: SUBJECT_COLOURS[subject.colour] }}>{subject.emoji} {subject.name}</span>
        <span
          role="status" data-testid="save-state"
          className={`chip ml-auto ${state === "saved" ? "bg-highlight on-colour" : state === "error" ? "chip-bad" : ""}`}
        >
          {label}
        </span>
      </div>
      {state === "error" && errorMsg && <p role="alert" className="error-text">{errorMsg}</p>}
      <label htmlFor="note-title" className="sr-only">Title</label>
      <input
        id="note-title" value={title} maxLength={200} placeholder="Untitled note"
        onChange={(e) => { setTitle(e.target.value); titleRef.current = e.target.value; schedule(); }}
        className="w-full rounded-md border-2 border-transparent bg-transparent px-1 text-3xl font-bold focus:border-ink focus:bg-card"
      />
      <Toolbar editor={editor} />
      <div className="paper-sheet px-4 py-3 sm:px-8 sm:py-5" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} />
      </div>
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>Delete note</Button>
      </div>
      <Dialog open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Delete this note?">
        <p>&ldquo;{title || "Untitled note"}&rdquo; will be gone for good.</p>
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

function Toolbar({ editor }: { editor: Editor | null }) {
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
    </div>
  );
}
