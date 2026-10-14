import "server-only";
import { inputHash } from "@/lib/ai/cache";
import { fitPassages } from "@/lib/ai/prompts";
import { MINDMAP_MAX_CHARS } from "@/lib/ai/tasks";
import type { MindmapGraph } from "@/lib/ai/types";
import type { ChunkRow, Mindmap, MindmapSources, Repo } from "./repo/types";

export type MindmapSourceOption = { id: string; kind: "note" | "file"; title: string; chars: number };

/** Notes with text and ready files, with how much text each holds (for "Choose sources"). */
export async function mindmapSourceOptions(repo: Repo, subjectId: string): Promise<{ options: MindmapSourceOption[]; chunks: ChunkRow[] }> {
  const [notes, files, chunks] = await Promise.all([repo.listNotes(subjectId), repo.listSources(subjectId), repo.listChunks({ subjectId })]);
  const chars = new Map<string, number>();
  for (const c of chunks) {
    const k = c.noteId ?? c.sourceId!;
    chars.set(k, (chars.get(k) ?? 0) + c.text.length);
  }
  const options: MindmapSourceOption[] = [
    ...notes.filter((n) => (chars.get(n.id) ?? 0) > 0).map((n) => ({ id: n.id, kind: "note" as const, title: n.title || "Untitled note", chars: chars.get(n.id) ?? 0 })),
    ...files.filter((f) => f.extractStatus === "ready").map((f) => ({ id: f.id, kind: "file" as const, title: f.fileName, chars: chars.get(f.id) ?? 0 })),
  ];
  return { options, chunks };
}

/** The passages a selection covers, fitted to one request, and the cache key for them. */
export function mindmapInput(subjectName: string, options: MindmapSourceOption[], chunks: ChunkRow[], sel: MindmapSources) {
  const allowed = new Set(options.filter((o) => sel.all || (o.kind === "note" ? sel.noteIds : sel.sourceIds).includes(o.id)).map((o) => o.id));
  const chosen = chunks
    .filter((c) => allowed.has(c.noteId ?? c.sourceId!))
    // notes first, then files; reading order inside each
    .sort((a, b) => Number(!!a.sourceId) - Number(!!b.sourceId) || (a.noteId ?? a.sourceId!).localeCompare(b.noteId ?? b.sourceId!) || a.ordinal - b.ordinal);
  const totalChars = chosen.reduce((n, c) => n + c.text.length, 0);
  const picked = fitPassages(chosen, MINDMAP_MAX_CHARS);
  const used = options.filter((o) => allowed.has(o.id));
  return {
    picked,
    totalChars,
    hash: inputHash("mindmap", picked.map((c) => c.contentHash), { subject: subjectName }),
    sources: {
      all: sel.all,
      noteIds: used.filter((o) => o.kind === "note").map((o) => o.id),
      sourceIds: used.filter((o) => o.kind === "file").map((o) => o.id),
    } satisfies MindmapSources,
  };
}

export type MindmapView = {
  graph: MindmapGraph;
  createdAt: string;
  madeFrom: { notes: number; files: number };
  /** The notes changed since this map was made. */
  changed: boolean;
};

export function mindmapView(map: Mindmap, currentHash: string): MindmapView {
  return {
    graph: map.graph,
    createdAt: map.createdAt,
    madeFrom: { notes: map.sources.noteIds.length, files: map.sources.sourceIds.length },
    changed: currentHash !== map.inputHash,
  };
}
