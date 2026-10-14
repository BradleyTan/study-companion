import "server-only";
import { planChunkSync, type Chunk } from "@/lib/extract/chunk";
import { newSrs } from "@/lib/srs/scheduler";
import type { SettingsUpdate } from "@/lib/validation";
import type { CardReview, ChunkRow, ExportBundle, Flashcard, Mindmap, Note, Profile, Repo, Source, Subject } from "./types";

// In-memory store for demo mode (no Supabase configured). Kept on globalThis so it
// survives hot reloads in dev. Each demo visitor gets their own random user id.
type Owned<T> = T & { userId: string };
type Store = {
  subjects: Map<string, Owned<Omit<Subject, "noteCount" | "sourceCount">>>;
  notes: Map<string, Owned<Note>>;
  sources: Map<string, Owned<Source>>;
  /** Passages by note or source id. */
  chunks: Map<string, Owned<ChunkRow>[]>;
  files: Map<string, Uint8Array>;
  profiles: Map<string, Profile>;
  uploadLog: { userId: string; at: string }[];
  flashcards: Map<string, Owned<Flashcard>>;
  reviews: Map<string, Owned<CardReview & { clientKey: string | null }>>;
  mindmaps: Map<string, Owned<Mindmap>>; // by subject id
  aiUsage: Map<string, { count: number; attempts?: number; inputTokens: number; outputTokens: number }>; // user|day|kind
  appUsage: Map<string, { requests: number; tokens: number }>; // day|model
  aiCache: Map<string, { model: string; output: unknown }>; // user|kind|hash
};
const g = globalThis as unknown as { __demoStore?: Store };
export const store: Store = (g.__demoStore ??= {
  subjects: new Map(), notes: new Map(), sources: new Map(), chunks: new Map(), files: new Map(), profiles: new Map(), uploadLog: [],
  flashcards: new Map(), reviews: new Map(), mindmaps: new Map(), aiUsage: new Map(), appUsage: new Map(), aiCache: new Map(),
});
// A store created by an older build (hot reload) may miss the Step 2 maps.
for (const k of ["flashcards", "reviews", "mindmaps", "aiUsage", "appUsage", "aiCache"] as const) store[k] ??= new Map() as never;

const now = () => new Date().toISOString();
const DEFAULT_PROFILE: Profile = { soundOn: true, volume: 0.35, theme: "system", timezone: "UTC" };
const clone = <T>(v: T): T => structuredClone(v);

/** What deleting a note or file does to cards and passages (mirrors the SQL foreign keys). */
function dropChunks(ownerId: string, link: "noteId" | "sourceId") {
  const gone = new Set((store.chunks.get(ownerId) ?? []).map((c) => c.id));
  store.chunks.delete(ownerId);
  for (const f of store.flashcards.values()) {
    if (f.chunkId && gone.has(f.chunkId)) f.chunkId = null;
    if (f[link] === ownerId) f[link] = null;
  }
}

export function demoRepo(userId: string): Repo {
  const own = <T extends { userId: string }>(row: T | undefined) => (row && row.userId === userId ? row : undefined);
  const counts = (subjectId: string) => ({
    noteCount: [...store.notes.values()].filter((n) => n.subjectId === subjectId).length,
    sourceCount: [...store.sources.values()].filter((s) => s.subjectId === subjectId).length,
  });
  const strip = <T extends { userId: string }>(row: T): Omit<T, "userId"> => {
    const { userId: owner, ...rest } = row;
    void owner;
    return clone(rest);
  };
  const myChunks = () => [...store.chunks.values()].flat().filter((c) => c.userId === userId);
  const stripReview = (r: Owned<CardReview & { clientKey: string | null }>): CardReview => {
    const { userId: u, ...rest } = r;
    void u;
    return clone(rest);
  };
  const toChunkRows = (subjectId: string, link: { noteId?: string; sourceId?: string }, chunks: Chunk[]): Owned<ChunkRow>[] =>
    chunks.map((c) => ({ id: crypto.randomUUID(), userId, subjectId, noteId: link.noteId ?? null, sourceId: link.sourceId ?? null, ordinal: c.ordinal, page: c.page, text: c.text, contentHash: c.contentHash }));

  const repo: Repo = {
    userId,
    async listSubjects() {
      return [...store.subjects.values()]
        .filter((s) => s.userId === userId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map((s) => ({ ...strip(s), ...counts(s.id) }));
    },
    async getSubject(id) {
      const s = own(store.subjects.get(id));
      return s ? { ...strip(s), ...counts(s.id) } : null;
    },
    async createSubject(input) {
      const s = { id: crypto.randomUUID(), userId, createdAt: now(), ...input };
      store.subjects.set(s.id, s);
      return { ...strip(s), noteCount: 0, sourceCount: 0 };
    },
    async updateSubject(id, input) {
      const s = own(store.subjects.get(id));
      if (s) Object.assign(s, input);
    },
    async deleteSubject(id) {
      if (!own(store.subjects.get(id))) return;
      store.subjects.delete(id);
      for (const [k, n] of store.notes) if (n.subjectId === id) { store.notes.delete(k); store.chunks.delete(k); }
      for (const [k, s] of store.sources) if (s.subjectId === id) { store.sources.delete(k); store.chunks.delete(k); store.files.delete(s.storagePath); }
      for (const [k, f] of store.flashcards) if (f.subjectId === id) store.flashcards.delete(k);
      for (const [k, r] of store.reviews) if (r.subjectId === id) store.reviews.delete(k);
      store.mindmaps.delete(id);
    },
    async listNotes(subjectId) {
      return [...store.notes.values()]
        .filter((n) => n.userId === userId && n.subjectId === subjectId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ id, subjectId, title, preview, updatedAt, contentText }) => ({ id, subjectId, title, preview, updatedAt, chars: title.length + contentText.length }));
    },
    async getNote(id) {
      const n = own(store.notes.get(id));
      return n ? strip(n) : null;
    },
    async createNote(subjectId) {
      if (!own(store.subjects.get(subjectId))) throw new Error("Subject not found");
      const n = { id: crypto.randomUUID(), userId, subjectId, title: "", preview: "", updatedAt: now(), contentJson: { type: "doc", content: [] }, contentText: "", chars: 0 };
      store.notes.set(n.id, n);
      return { id: n.id };
    },
    async updateNote(id, input) {
      const n = own(store.notes.get(id));
      if (!n) throw new Error("Note not found");
      Object.assign(n, input, { preview: input.contentText.slice(0, 140), updatedAt: now(), chars: input.title.length + input.contentText.length });
      return { updatedAt: n.updatedAt };
    },
    async deleteNote(id) {
      if (own(store.notes.get(id))) { store.notes.delete(id); dropChunks(id, "noteId"); }
    },
    async replaceNoteChunks(noteId, subjectId, chunks) {
      if (!own(store.notes.get(noteId))) return;
      const existing = store.chunks.get(noteId) ?? [];
      const plan = planChunkSync(existing, chunks);
      const removed = new Set(plan.remove);
      const ordinal = new Map(plan.keep.map((k) => [k.id, k.ordinal]));
      const kept = existing.filter((c) => !removed.has(c.id)).map((c) => ({ ...c, ordinal: ordinal.get(c.id) ?? c.ordinal }));
      store.chunks.set(noteId, [...kept, ...toChunkRows(subjectId, { noteId }, plan.insert)].sort((a, b) => a.ordinal - b.ordinal));
      for (const f of store.flashcards.values()) if (f.chunkId && removed.has(f.chunkId)) f.chunkId = null;
    },
    async listSources(subjectId) {
      return [...store.sources.values()]
        .filter((s) => s.userId === userId && s.subjectId === subjectId)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .map(strip);
    },
    async getSource(id) {
      const s = own(store.sources.get(id));
      return s ? strip(s) : null;
    },
    async createSource(input) {
      if (!own(store.subjects.get(input.subjectId))) throw new Error("Subject not found");
      const s: Owned<Source> = { ...input, userId, pageCount: null, extractStatus: "pending", extractError: null, createdAt: now() };
      store.sources.set(s.id, s);
      return strip(s);
    },
    async updateSource(id, patch) {
      const s = own(store.sources.get(id));
      if (s) Object.assign(s, patch);
    },
    async deleteSource(id) {
      const s = own(store.sources.get(id));
      if (!s) return null;
      store.sources.delete(id);
      dropChunks(id, "sourceId");
      store.files.delete(s.storagePath);
      return { storagePath: s.storagePath };
    },
    async replaceSourceChunks(sourceId, subjectId, chunks) {
      if (!own(store.sources.get(sourceId))) return;
      dropChunks(sourceId, "sourceId");
      store.chunks.set(sourceId, toChunkRows(subjectId, { sourceId }, chunks));
    },
    async uploadStats(sinceIso) {
      const mine = [...store.sources.values()].filter((s) => s.userId === userId);
      const countSince = store.uploadLog.filter((l) => l.userId === userId && l.at >= sinceIso).length;
      return { countSince, totalBytes: mine.reduce((n, s) => n + s.sizeBytes, 0) };
    },
    async recordUpload() {
      store.uploadLog.push({ userId, at: now() });
    },

    async listChunks(filter) {
      const list = "noteId" in filter ? store.chunks.get(filter.noteId) ?? []
        : "sourceId" in filter ? store.chunks.get(filter.sourceId) ?? []
        : myChunks().filter((c) => c.subjectId === filter.subjectId);
      return list.filter((c) => c.userId === userId).sort((a, b) => a.ordinal - b.ordinal).map(strip);
    },
    async getChunks(ids) {
      const want = new Set(ids);
      return myChunks().filter((c) => want.has(c.id)).map(strip);
    },

    async listFlashcards(filter = {}) {
      return [...store.flashcards.values()]
        .filter((f) => f.userId === userId && !f.deletedAt && (!filter.subjectId || f.subjectId === filter.subjectId))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .map(strip);
    },
    async getFlashcard(id) {
      const f = own(store.flashcards.get(id));
      return f ? strip(f) : null;
    },
    async findFlashcardsByHash(inputHash) {
      return (await repo.listFlashcards()).filter((f) => f.inputHash === inputHash);
    },
    async createFlashcards(cards) {
      const t = now();
      const mineChunks = new Set(myChunks().map((c) => c.id));
      return cards.map((c, i) => {
        if (!own(store.subjects.get(c.subjectId))) throw new Error("Subject not found");
        if (c.chunkId && !mineChunks.has(c.chunkId)) throw new Error("Passage not found");
        // Keep creation order stable within a batch (newest first lists the first card first).
        const createdAt = new Date(Date.parse(t) - i).toISOString();
        const f: Owned<Flashcard> = {
          id: crypto.randomUUID(), userId, subjectId: c.subjectId, front: c.front, back: c.back, origin: c.origin,
          sourceQuote: c.sourceQuote ?? null, chunkId: c.chunkId ?? null, noteId: c.noteId ?? null, sourceId: c.sourceId ?? null,
          page: c.page ?? null, inputHash: c.inputHash ?? null, edited: false, deletedAt: null, createdAt, srs: newSrs(new Date(createdAt)),
        };
        store.flashcards.set(f.id, f);
        return strip(f);
      });
    },
    async updateFlashcardText(id, input) {
      const f = own(store.flashcards.get(id));
      if (f) Object.assign(f, input, { edited: true });
    },
    async setFlashcardDeleted(id, deleted) {
      const f = own(store.flashcards.get(id));
      if (f) f.deletedAt = deleted ? now() : null;
    },
    async setFlashcardSrs(id, srs) {
      const f = own(store.flashcards.get(id));
      if (f) f.srs = clone(srs);
    },

    async addCardReview(input) {
      if (input.clientKey) {
        const dup = [...store.reviews.values()].find((r) => r.userId === userId && r.clientKey === input.clientKey);
        if (dup) return stripReview(dup);
      }
      if (!own(store.flashcards.get(input.flashcardId))) throw new Error("Card not found");
      const r = { ...clone(input), id: crypto.randomUUID(), userId };
      store.reviews.set(r.id, r);
      return stripReview(r);
    },
    async latestReviews(flashcardId, limit) {
      return [...store.reviews.values()]
        .filter((r) => r.userId === userId && r.flashcardId === flashcardId)
        .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt))
        .slice(0, limit)
        .map(stripReview);
    },
    async deleteCardReview(id) {
      if (own(store.reviews.get(id))) store.reviews.delete(id);
    },
    async countIntroducedSince(sinceIso) {
      return [...store.reviews.values()].filter((r) => r.userId === userId && r.prevState === 0 && r.reviewedAt >= sinceIso).length;
    },

    async countReviewsSince(sinceIso) {
      return [...store.reviews.values()].filter((r) => r.userId === userId && r.reviewedAt >= sinceIso).length;
    },

    async getMindmap(subjectId) {
      const m = own(store.mindmaps.get(subjectId));
      return m ? strip(m) : null;
    },
    async saveMindmap(subjectId, input) {
      if (!own(store.subjects.get(subjectId))) throw new Error("Subject not found");
      const prev = own(store.mindmaps.get(subjectId));
      const t = now();
      const m: Owned<Mindmap> = { id: prev?.id ?? crypto.randomUUID(), userId, subjectId, ...clone(input), createdAt: t, updatedAt: t };
      store.mindmaps.set(subjectId, m);
      return strip(m);
    },
    async updateMindmapGraph(subjectId, graph) {
      const m = own(store.mindmaps.get(subjectId));
      if (m) Object.assign(m, { graph: clone(graph), updatedAt: now() });
    },

    async aiUsageCount(day, kind) {
      return store.aiUsage.get(`${userId}|${day}|${kind}`)?.count ?? 0;
    },
    async reserveAi(day, kind, limit, maxAttempts) {
      const key = `${userId}|${day}|${kind}`;
      const row = store.aiUsage.get(key) ?? { count: 0, attempts: 0, inputTokens: 0, outputTokens: 0 };
      const attempts = row.attempts ?? 0;
      if (row.count >= limit || attempts >= maxAttempts) return false;
      store.aiUsage.set(key, { ...row, count: row.count + 1, attempts: attempts + 1 });
      return true;
    },
    async settleAi(day, kind, ok, inputTokens, outputTokens) {
      const row = store.aiUsage.get(`${userId}|${day}|${kind}`);
      if (!row) return;
      if (!ok) row.count = Math.max(0, row.count - 1);
      row.inputTokens += inputTokens;
      row.outputTokens += outputTokens;
    },
    async reserveAppBudget(day, model, maxRequests, maxTokens) {
      const key = `${day}|${model}`;
      const row = store.appUsage.get(key) ?? { requests: 0, tokens: 0 };
      if (row.requests >= maxRequests || row.tokens >= maxTokens) return false;
      store.appUsage.set(key, { ...row, requests: row.requests + 1 });
      return true;
    },
    async addAppTokens(day, model, tokens) {
      const row = store.appUsage.get(`${day}|${model}`);
      if (row) row.tokens += tokens;
    },
    async appBudgetLeft(day, model, maxRequests, maxTokens) {
      const row = store.appUsage.get(`${day}|${model}`);
      return !row || (row.requests < maxRequests && row.tokens < maxTokens);
    },
    async getAiCache(kind, inputHash) {
      const hit = store.aiCache.get(`${userId}|${kind}|${inputHash}`);
      return hit ? clone(hit) : null;
    },
    async putAiCache(kind, inputHash, model, output) {
      store.aiCache.set(`${userId}|${kind}|${inputHash}`, { model, output: clone(output) });
    },

    async getProfile() {
      return { ...DEFAULT_PROFILE, ...store.profiles.get(userId) };
    },
    async updateProfile(patch: SettingsUpdate) {
      store.profiles.set(userId, { ...DEFAULT_PROFILE, ...store.profiles.get(userId), ...patch });
    },
    async exportAll(): Promise<ExportBundle> {
      const subjects = await repo.listSubjects();
      const notes = [...store.notes.values()].filter((n) => n.userId === userId).map(strip);
      const sources = [...store.sources.values()].filter((s) => s.userId === userId).map((s) => ({
        ...strip(s),
        extractedText: (store.chunks.get(s.id) ?? []).map((c) => c.text).join("\n\n"),
      }));
      return {
        exportedAt: now(), profile: await repo.getProfile(), subjects, notes, sources,
        flashcards: [...store.flashcards.values()].filter((f) => f.userId === userId).map(strip),
        cardReviews: [...store.reviews.values()].filter((r) => r.userId === userId).map(stripReview),
        mindmaps: [...store.mindmaps.values()].filter((m) => m.userId === userId).map(strip),
      };
    },
  };
  return repo;
}

export function demoDeleteUser(userId: string) {
  for (const [k, s] of store.subjects) if (s.userId === userId) store.subjects.delete(k);
  for (const [k, n] of store.notes) if (n.userId === userId) { store.notes.delete(k); store.chunks.delete(k); }
  for (const [k, s] of store.sources) if (s.userId === userId) { store.sources.delete(k); store.chunks.delete(k); store.files.delete(s.storagePath); }
  for (const [k, f] of store.flashcards) if (f.userId === userId) store.flashcards.delete(k);
  for (const [k, r] of store.reviews) if (r.userId === userId) store.reviews.delete(k);
  for (const [k, m] of store.mindmaps) if (m.userId === userId) store.mindmaps.delete(k);
  for (const k of store.aiUsage.keys()) if (k.startsWith(`${userId}|`)) store.aiUsage.delete(k);
  for (const k of store.aiCache.keys()) if (k.startsWith(`${userId}|`)) store.aiCache.delete(k);
  store.profiles.delete(userId);
}
