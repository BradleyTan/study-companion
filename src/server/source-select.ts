import "server-only";
import { fitsOneSet, isCovered, pageStats, pageStatsFromCounts, seriesNext, type PageRange, type PageStats } from "@/lib/page-range";
import { syncNoteChunks } from "./passages";
import type { ChunkRow, Repo } from "./repo/types";

// Picking the passages a generation reads, shared by "Make flashcards" and "Make a quiz"
// (flashcards.md "Long files", quiz-builder.md "Page ranges"): the dialogs' source lists with
// per-page counts, and one note or a page range of one file. Each caller passes its own budget.

export type SourceOptions = {
  notes: { id: string; title: string; chars: number; updatedAt: string }[];
  files: {
    id: string; name: string; kind: "pdf" | "pptx"; pageCount: number | null; status: string;
    /** Characters per page (index 0 = page 1); null when the passages have no page numbers. Counts only, never text. */
    pageChars: number[] | null;
    /** Characters in passages without a page number (sent with every range). */
    looseChars: number;
    /** The whole file fits one set: no page fields. */
    fitsOneSet: boolean;
  }[];
};

/** Notes and files for a dialog, with per-page character counts of ready files (never their text). */
export async function sourceOptions(repo: Repo, subjectId: string, budget: number): Promise<SourceOptions> {
  const [notes, files, counts] = await Promise.all([repo.listNotes(subjectId), repo.listSources(subjectId), repo.listPageChars(subjectId)]);
  // Counts summed in the database, one query per dialog open (security review S2-9): never the passages' text.
  const bySource = new Map<string, typeof counts>();
  for (const r of counts) {
    const list = bySource.get(r.sourceId);
    if (list) list.push(r); else bySource.set(r.sourceId, [r]);
  }
  const stats = files.map((f): PageStats =>
    f.extractStatus === "ready" ? pageStatsFromCounts(bySource.get(f.id) ?? [], f.pageCount) : { pageChars: null, looseChars: 0, totalChars: 0 });
  return {
    notes: notes.map((n) => ({ id: n.id, title: n.title || "Untitled note", chars: n.chars, updatedAt: n.updatedAt })),
    files: files.map((f, i) => ({
      id: f.id, name: f.fileName, kind: f.kind, pageCount: f.pageCount, status: f.extractStatus,
      pageChars: stats[i].pageChars, looseChars: stats[i].looseChars, fitsOneSet: fitsOneSet(stats[i].totalChars, budget),
    })),
  };
}

/**
 * Where a file's set sits in the series (flashcards.md "Long files"): the range read, whether
 * every passage fitted (else sampled), the file's page count and the next range by the fit rule.
 */
export type FileSeries = { range: PageRange; covered: boolean; pageCount: number; next: PageRange | null };

export type Found = {
  chunks: ChunkRow[];
  noteId: string | null;
  sourceId: string | null;
  /** The note's title or the file's name (for titles and summaries). */
  name: string;
  unit: "page" | "slide";
  series: FileSeries | null;
};

export type PickedSource = { type: "note"; id: string } | { type: "file"; id: string; fromPage?: number; toPage?: number };

/**
 * The passages of one note (synced with its latest text) or of a page range of one ready file.
 * Null when it isn't the student's or isn't in this subject; an error for a range past the end.
 */
export async function sourceChunks(repo: Repo, subjectId: string, source: PickedSource, budget: number): Promise<Found | { error: string } | null> {
  if (source.type === "note") {
    const note = await repo.getNote(source.id);
    if (!note || note.subjectId !== subjectId) return null;
    await syncNoteChunks(repo, note); // make sure passages match the latest text
    return { chunks: await repo.listChunks({ noteId: note.id }), noteId: note.id, sourceId: null, name: note.title || "Untitled note", unit: "page", series: null };
  }
  const file = await repo.getSource(source.id);
  if (!file || file.subjectId !== subjectId || file.extractStatus !== "ready") return null;
  const all = await repo.listChunks({ sourceId: file.id });
  const stats = pageStats(all, file.pageCount);
  const pageCount = Math.max(1, file.pageCount ?? 0, stats.pageChars?.length ?? 0);
  const unit = file.kind === "pptx" ? "slide" : "page";
  const base = { noteId: null, sourceId: file.id, name: file.fileName, unit } as const;
  if (source.fromPage === undefined || source.toPage === undefined) {
    // Whole file (it fits one set; a stale dialog sending a long file gets an even sample).
    const range = { from: 1, to: pageCount };
    return { ...base, chunks: all, series: { range, covered: fitsOneSet(stats.totalChars, budget), pageCount, next: null } };
  }
  if (source.fromPage > pageCount) return { error: `Pick a ${unit} between 1 and ${pageCount}.` };
  const range = { from: source.fromPage, to: Math.min(source.toPage, pageCount) };
  const chunks = all.filter((c) => c.page === null || (c.page >= range.from && c.page <= range.to));
  // Same rules as the dialog (src/lib/page-range.ts): a best-fit set continues by the fit rule, any other keeps its size.
  const covered = stats.pageChars ? isCovered(stats.pageChars, stats.looseChars, range, budget) : stats.totalChars <= budget;
  return { ...base, chunks, series: { range, pageCount, covered, next: seriesNext(stats.pageChars, stats.looseChars, range, pageCount, budget) } };
}
