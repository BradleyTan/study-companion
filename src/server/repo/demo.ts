import "server-only";
import type { Chunk } from "@/lib/extract/chunk";
import type { SettingsUpdate } from "@/lib/validation";
import type { ExportBundle, Note, Profile, Repo, Source, Subject } from "./types";

// In-memory store for demo mode (no Supabase configured). Kept on globalThis so it
// survives hot reloads in dev. Each demo visitor gets their own random user id.
type Store = {
  subjects: Map<string, Omit<Subject, "noteCount" | "sourceCount"> & { userId: string }>;
  notes: Map<string, Note & { userId: string }>;
  sources: Map<string, Source & { userId: string }>;
  chunks: Map<string, { userId: string; subjectId: string; noteId?: string; sourceId?: string; chunk: Chunk }[]>;
  files: Map<string, Uint8Array>;
  profiles: Map<string, Profile>;
  uploadLog: { userId: string; at: string }[];
};
const g = globalThis as unknown as { __demoStore?: Store };
export const store: Store = (g.__demoStore ??= {
  subjects: new Map(), notes: new Map(), sources: new Map(), chunks: new Map(), files: new Map(), profiles: new Map(), uploadLog: [],
});

const now = () => new Date().toISOString();
const DEFAULT_PROFILE: Profile = { soundOn: true, volume: 0.35, theme: "system" };

export function demoRepo(userId: string): Repo {
  const own = <T extends { userId: string }>(row: T | undefined) => (row && row.userId === userId ? row : undefined);
  const counts = (subjectId: string) => ({
    noteCount: [...store.notes.values()].filter((n) => n.subjectId === subjectId).length,
    sourceCount: [...store.sources.values()].filter((s) => s.subjectId === subjectId).length,
  });
  const strip = <T extends { userId: string }>(row: T): Omit<T, "userId"> => {
    const { userId: owner, ...rest } = row;
    void owner;
    return rest;
  };

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
    },
    async listNotes(subjectId) {
      return [...store.notes.values()]
        .filter((n) => n.userId === userId && n.subjectId === subjectId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map(({ id, subjectId, title, preview, updatedAt }) => ({ id, subjectId, title, preview, updatedAt }));
    },
    async getNote(id) {
      const n = own(store.notes.get(id));
      return n ? strip(n) : null;
    },
    async createNote(subjectId) {
      if (!own(store.subjects.get(subjectId))) throw new Error("Subject not found");
      const n = { id: crypto.randomUUID(), userId, subjectId, title: "", preview: "", updatedAt: now(), contentJson: { type: "doc", content: [] }, contentText: "" };
      store.notes.set(n.id, n);
      return { id: n.id };
    },
    async updateNote(id, input) {
      const n = own(store.notes.get(id));
      if (!n) throw new Error("Note not found");
      Object.assign(n, input, { preview: input.contentText.slice(0, 140), updatedAt: now() });
      return { updatedAt: n.updatedAt };
    },
    async deleteNote(id) {
      if (own(store.notes.get(id))) { store.notes.delete(id); store.chunks.delete(id); }
    },
    async replaceNoteChunks(noteId, subjectId, chunks) {
      store.chunks.set(noteId, chunks.map((chunk) => ({ userId, subjectId, noteId, chunk })));
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
      const s: Source & { userId: string } = { ...input, userId, pageCount: null, extractStatus: "pending", extractError: null, createdAt: now() };
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
      store.chunks.delete(id);
      store.files.delete(s.storagePath);
      return { storagePath: s.storagePath };
    },
    async replaceSourceChunks(sourceId, subjectId, chunks) {
      store.chunks.set(sourceId, chunks.map((chunk) => ({ userId, subjectId, sourceId, chunk })));
    },
    async uploadStats(sinceIso) {
      const mine = [...store.sources.values()].filter((s) => s.userId === userId);
      const countSince = store.uploadLog.filter((l) => l.userId === userId && l.at >= sinceIso).length;
      return { countSince, totalBytes: mine.reduce((n, s) => n + s.sizeBytes, 0) };
    },
    async recordUpload() {
      store.uploadLog.push({ userId, at: now() });
    },
    async getProfile() {
      return store.profiles.get(userId) ?? DEFAULT_PROFILE;
    },
    async updateProfile(patch: SettingsUpdate) {
      store.profiles.set(userId, { ...(store.profiles.get(userId) ?? DEFAULT_PROFILE), ...patch });
    },
    async exportAll(): Promise<ExportBundle> {
      const subjects = await repo.listSubjects();
      const notes = [...store.notes.values()].filter((n) => n.userId === userId).map(strip);
      const sources = [...store.sources.values()].filter((s) => s.userId === userId).map((s) => ({
        ...strip(s),
        extractedText: (store.chunks.get(s.id) ?? []).map((c) => c.chunk.text).join("\n\n"),
      }));
      return { exportedAt: now(), profile: await repo.getProfile(), subjects, notes, sources };
    },
  };
  return repo;
}

export function demoDeleteUser(userId: string) {
  for (const [k, s] of store.subjects) if (s.userId === userId) store.subjects.delete(k);
  for (const [k, n] of store.notes) if (n.userId === userId) { store.notes.delete(k); store.chunks.delete(k); }
  for (const [k, s] of store.sources) if (s.userId === userId) { store.sources.delete(k); store.chunks.delete(k); store.files.delete(s.storagePath); }
  store.profiles.delete(userId);
}
