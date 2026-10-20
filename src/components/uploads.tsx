"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { formatBytes } from "@/lib/time";
import { MAX_UPLOAD_BYTES } from "@/lib/validation";
import { deleteSource, getDownloadUrl, processUpload, startUpload, uploadDemoFile } from "@/server/actions/sources";
import type { Source } from "@/server/repo/types";
import { MakeFlashcardsDialog } from "./flashcards/make-dialog";
import { MakeQuizDialog } from "./quiz/make-quiz-dialog";
import { useSound } from "./sound-provider";
import { Button } from "./ui/button";
import { RowMenu } from "./ui/row-menu";

type Pending = { key: string; name: string; phase: "uploading" | "reading"; error?: string };

const ACCEPT = ".pdf,.pptx,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation";

export function Uploads({ subjectId, subjectName, sources, supabase }: { subjectId: string; subjectName: string; sources: Source[]; supabase: { url: string; key: string } | null }) {
  const [pending, setPending] = useState<Pending[]>([]);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { play } = useSound();
  const router = useRouter();

  const update = (key: string, patch: Partial<Pending> | null) =>
    setPending((list) => (patch === null ? list.filter((p) => p.key !== key) : list.map((p) => (p.key === key ? { ...p, ...patch } : p))));

  async function uploadOne(file: File) {
    const key = crypto.randomUUID();
    setPending((list) => [...list, { key, name: file.name, phase: "uploading" }]);
    const fail = (error: string) => { update(key, { error }); play("boop"); };

    const ext = file.name.toLowerCase().split(".").pop();
    if (ext !== "pdf" && ext !== "pptx") return fail("Only PDF and PPTX files can be uploaded.");
    if (file.size > MAX_UPLOAD_BYTES) return fail("That file is over 25 MB.");

    const started = await startUpload({ subjectId, fileName: file.name, size: file.size });
    if (!started.ok) return fail(started.error);
    if (started.mode === "supabase") {
      if (!supabase) return fail("Uploads aren't set up yet.");
      const sb = createSupabaseBrowserClient(supabase.url, supabase.key);
      const { error } = await sb.storage.from("sources").uploadToSignedUrl(started.path, started.token, file, { contentType: file.type || undefined });
      if (error) return fail("That upload didn't go through. Check your connection and try again.");
    } else {
      const form = new FormData();
      form.set("sourceId", started.sourceId);
      form.set("file", file);
      const res = await uploadDemoFile(form);
      if (!res.ok) return fail(res.error);
    }
    update(key, { phase: "reading" });
    router.refresh();
    const processed = await processUpload(started.sourceId);
    if (!processed.ok) return fail(processed.error);
    play(processed.status === "ready" ? "pop" : "boop");
    update(key, null);
    router.refresh();
  }

  function onFiles(files: FileList | null) {
    if (!files) return;
    [...files].slice(0, 10).forEach((f) => void uploadOne(f));
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); onFiles(e.dataTransfer.files); }}
        className={`flex flex-col items-center gap-2 rounded-lg border-[2.5px] border-dashed border-ink p-6 text-center ${drag ? "bg-highlight text-[var(--on-colour)]" : "bg-card/70"}`}
      >
        <p className="font-bold">Drop a PDF or PowerPoint here</p>
        <Button size="sm" onClick={() => inputRef.current?.click()}>Choose a file</Button>
        <p className="hint">PDF or PPTX, up to 25 MB</p>
        <input
          ref={inputRef} id="file-input" type="file" accept={ACCEPT} multiple className="sr-only" aria-label="Upload lecture files"
          onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }}
        />
      </div>

      <ul className="flex flex-col gap-3" role="list" aria-live="polite">
        {pending.map((p) => (
          <li key={p.key} className={`sticker-flat flex flex-wrap items-center gap-2 p-3 ${p.error ? "shake" : ""}`}>
            <span className="min-w-0 flex-1 truncate font-bold">{p.name}</span>
            {p.error ? (
              <>
                <span role="alert" className="error-text">{p.error}</span>
                <Button size="sm" variant="ghost" onClick={() => update(p.key, null)}>Dismiss</Button>
              </>
            ) : (
              <span className="chip chip-busy">{p.phase === "uploading" ? "Uploading…" : "Reading text…"}</span>
            )}
          </li>
        ))}
        {sources.map((s) => <SourceRow key={s.id} source={s} subjectName={subjectName} />)}
      </ul>
      {sources.length === 0 && pending.length === 0 && <p className="hint">No lecture files yet. Upload slides or PDFs from your lecturer.</p>}
    </div>
  );
}

function statusChip(s: Source) {
  const unit = s.kind === "pdf" ? "page" : "slide";
  switch (s.extractStatus) {
    case "ready": return <span className="chip chip-ready">Ready · {s.pageCount} {unit}{s.pageCount === 1 ? "" : "s"}</span>;
    case "no_text": return <span className="chip chip-bad" title="Handwritten and scanned files will be supported later.">No text found (scanned?)</span>;
    case "failed": return <span className="chip chip-bad">{s.extractError ?? "Couldn't read"}</span>;
    default: return <span className="chip chip-busy">Reading text…</span>;
  }
}

function SourceRow({ source, subjectName }: { source: Source; subjectName: string }) {
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [everMade, setEverMade] = useState(false);
  const [pending, start] = useTransition();
  const { play } = useSound();
  const router = useRouter();
  const ready = source.extractStatus === "ready";
  // "Open": the original in a new tab, like the source page's "Open the original file" (subject.md).
  const openFile = () => start(async () => {
    const res = await getDownloadUrl(source.id);
    if (res.ok) window.open(res.url, "_blank", "noopener");
    else { setError(res.error); play("boop"); }
  });
  const make = () => { setEverMade(true); setMaking(true); };
  const [quizzing, setQuizzing] = useState(false);
  const [everQuizzed, setEverQuizzed] = useState(false);
  const makeQuiz = () => { setEverQuizzed(true); setQuizzing(true); };
  return (
    <li className="sticker-flat flex flex-wrap items-center gap-2 p-3" data-testid="source-row">
      {/* Line 1: type, name, size. Line 2: status, then the actions (polish.md P1-8). */}
      <span className="chip">{source.kind.toUpperCase()}</span>
      <span className="min-w-0 flex-1 truncate font-bold" title={source.fileName}>{source.fileName}</span>
      <span className="hint">{formatBytes(source.sizeBytes)}</span>
      {source.extractStatus === "no_text" && <span className="hint basis-full">Handwritten and scanned files will be supported later.</span>}
      {confirm ? (
        <div className="flex basis-full flex-wrap items-center justify-end gap-2">
          <span className="mr-auto">{statusChip(source)}</span>
          <span className="hint">Flashcards and quizzes made from it stay, with their quotes.</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Keep</Button>
          <Button
            size="sm" variant="danger" sound="tear" disabled={pending}
            onClick={() => start(async () => { await deleteSource(source.id); router.refresh(); })}
          >
            Delete file
          </Button>
        </div>
      ) : (
        <div className="flex basis-full flex-wrap items-center gap-2">
          {statusChip(source)}
          <div className="ml-auto hidden gap-1 sm:flex">
            <Button size="sm" onClick={openFile} aria-label={`Open ${source.fileName}`}>Open</Button>
            {ready && <Button size="sm" onClick={make} aria-label={`Make flashcards from ${source.fileName}`}>Make flashcards</Button>}
          </div>
          {/* Tablet and laptop: "Make a quiz" and "Delete" sit in "⋯" so the row doesn't overflow (subject.md). */}
          <RowMenu
            className="hidden sm:block"
            label={`More for ${source.fileName}`}
            items={[
              ...(ready ? [{ label: "Make a quiz", onSelect: makeQuiz }] : []),
              { label: "Delete", onSelect: () => setConfirm(true), danger: true },
            ]}
          />
          <RowMenu
            className="ml-auto sm:hidden"
            label={`More for ${source.fileName}`}
            items={[
              { label: "Open", onSelect: openFile },
              ...(ready ? [{ label: "Make flashcards", onSelect: make }, { label: "Make a quiz", onSelect: makeQuiz }] : []),
              { label: "Delete", onSelect: () => setConfirm(true), danger: true },
            ]}
          />
        </div>
      )}
      {error && <p role="alert" className="error-text basis-full">{error}</p>}
      {everMade && (
        <MakeFlashcardsDialog subjectId={source.subjectId} subjectName={subjectName} open={making} onClose={() => setMaking(false)} preset={{ type: "file", id: source.id }} />
      )}
      {everQuizzed && (
        <MakeQuizDialog subjectId={source.subjectId} subjectName={subjectName} open={quizzing} onClose={() => setQuizzing(false)} preset={{ type: "file", id: source.id }} />
      )}
    </li>
  );
}
