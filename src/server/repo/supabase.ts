import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Chunk } from "@/lib/extract/chunk";
import type { SubjectColour } from "@/lib/subjects";
import type { ExportBundle, Note, NoteSummary, Profile, Repo, Source, Subject } from "./types";

type Row = Record<string, unknown>;

function fail(error: { message: string } | null, what: string): asserts error is null {
  if (error) throw new Error(`${what}: ${error.message}`);
}

const toSubject = (r: Row): Subject => ({
  id: r.id as string,
  name: r.name as string,
  colour: r.colour as SubjectColour,
  emoji: r.emoji as string,
  createdAt: r.created_at as string,
  noteCount: ((r.notes as { count: number }[] | undefined)?.[0]?.count) ?? 0,
  sourceCount: ((r.sources as { count: number }[] | undefined)?.[0]?.count) ?? 0,
});
const toNoteSummary = (r: Row): NoteSummary => ({
  id: r.id as string,
  subjectId: r.subject_id as string,
  title: r.title as string,
  preview: ((r.content_text as string | undefined) ?? "").slice(0, 140),
  updatedAt: r.updated_at as string,
});
const toSource = (r: Row): Source => ({
  id: r.id as string,
  subjectId: r.subject_id as string,
  fileName: r.file_name as string,
  kind: r.kind as Source["kind"],
  sizeBytes: r.size_bytes as number,
  storagePath: r.storage_path as string,
  pageCount: (r.page_count as number | null) ?? null,
  extractStatus: r.extract_status as Source["extractStatus"],
  extractError: (r.extract_error as string | null) ?? null,
  createdAt: r.created_at as string,
});

const SUBJECT_COLS = "id, name, colour, emoji, created_at, notes(count), sources(count)";

/**
 * `db` is a user-scoped client (publishable key + the student's session), so RLS applies.
 * `admin` (secret key, bypasses RLS) is used only for rows students may not write
 * themselves: sources, chunks and the upload log. Every admin query is pinned to `userId`.
 */
export function supabaseRepo(db: SupabaseClient, userId: string, admin: () => SupabaseClient): Repo {
  const chunkRows = (subjectId: string, link: { note_id?: string; source_id?: string }, chunks: Chunk[]) =>
    chunks.map((c) => ({ user_id: userId, subject_id: subjectId, ...link, ordinal: c.ordinal, page: c.page, text: c.text, content_hash: c.contentHash }));

  // PostgREST caps a response at 1,000 rows, so page through every chunk for export.
  async function allSourceChunks(): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db
        .from("chunks")
        .select("source_id, ordinal, text")
        .not("source_id", "is", null)
        .order("source_id")
        .order("ordinal")
        .range(from, from + 999);
      fail(error, "export chunks");
      out.push(...(data ?? []));
      if (!data || data.length < 1000) return out;
    }
  }

  const repo: Repo = {
    userId,
    async listSubjects() {
      const { data, error } = await db.from("subjects").select(SUBJECT_COLS).eq("archived", false).order("created_at");
      fail(error, "listSubjects");
      return (data ?? []).map(toSubject);
    },
    async getSubject(id) {
      const { data, error } = await db.from("subjects").select(SUBJECT_COLS).eq("id", id).maybeSingle();
      fail(error, "getSubject");
      return data ? toSubject(data) : null;
    },
    async createSubject(input) {
      const { data, error } = await db.from("subjects").insert({ ...input, user_id: userId }).select(SUBJECT_COLS).single();
      fail(error, "createSubject");
      return toSubject(data);
    },
    async updateSubject(id, input) {
      const { error } = await db.from("subjects").update(input).eq("id", id);
      fail(error, "updateSubject");
    },
    async deleteSubject(id) {
      const { error } = await db.from("subjects").delete().eq("id", id);
      fail(error, "deleteSubject");
    },
    async listNotes(subjectId) {
      const { data, error } = await db.from("notes").select("id, subject_id, title, content_text, updated_at").eq("subject_id", subjectId).order("updated_at", { ascending: false });
      fail(error, "listNotes");
      return (data ?? []).map(toNoteSummary);
    },
    async getNote(id) {
      const { data, error } = await db.from("notes").select("*").eq("id", id).maybeSingle();
      fail(error, "getNote");
      if (!data) return null;
      return { ...toNoteSummary(data), contentJson: data.content_json, contentText: data.content_text } satisfies Note;
    },
    async createNote(subjectId) {
      const { data, error } = await db.from("notes").insert({ subject_id: subjectId, user_id: userId }).select("id").single();
      fail(error, "createNote");
      return { id: data.id as string };
    },
    async updateNote(id, input) {
      const { data, error } = await db
        .from("notes")
        .update({ title: input.title, content_json: input.contentJson, content_text: input.contentText })
        .eq("id", id)
        .select("updated_at")
        .single();
      fail(error, "updateNote");
      return { updatedAt: data.updated_at as string };
    },
    async deleteNote(id) {
      const { error } = await db.from("notes").delete().eq("id", id);
      fail(error, "deleteNote");
    },
    async replaceNoteChunks(noteId, subjectId, chunks) {
      const del = await admin().from("chunks").delete().eq("note_id", noteId).eq("user_id", userId);
      fail(del.error, "replaceNoteChunks");
      if (chunks.length) fail((await admin().from("chunks").insert(chunkRows(subjectId, { note_id: noteId }, chunks))).error, "replaceNoteChunks");
    },
    async listSources(subjectId) {
      const { data, error } = await db.from("sources").select("*").eq("subject_id", subjectId).order("created_at", { ascending: false });
      fail(error, "listSources");
      return (data ?? []).map(toSource);
    },
    async getSource(id) {
      const { data, error } = await db.from("sources").select("*").eq("id", id).maybeSingle();
      fail(error, "getSource");
      return data ? toSource(data) : null;
    },
    async createSource(input) {
      const { data, error } = await admin()
        .from("sources")
        .insert({ id: input.id, user_id: userId, subject_id: input.subjectId, file_name: input.fileName, kind: input.kind, size_bytes: input.sizeBytes, storage_path: input.storagePath })
        .select("*")
        .single();
      fail(error, "createSource");
      return toSource(data);
    },
    async updateSource(id, patch) {
      const row: Row = {};
      if (patch.extractStatus !== undefined) row.extract_status = patch.extractStatus;
      if (patch.extractError !== undefined) row.extract_error = patch.extractError;
      if (patch.pageCount !== undefined) row.page_count = patch.pageCount;
      if (patch.sizeBytes !== undefined) row.size_bytes = patch.sizeBytes;
      fail((await admin().from("sources").update(row).eq("id", id).eq("user_id", userId)).error, "updateSource");
    },
    async deleteSource(id) {
      const { data, error } = await db.from("sources").delete().eq("id", id).select("storage_path").maybeSingle();
      fail(error, "deleteSource");
      return data ? { storagePath: data.storage_path as string } : null;
    },
    async replaceSourceChunks(sourceId, subjectId, chunks) {
      fail((await admin().from("chunks").delete().eq("source_id", sourceId).eq("user_id", userId)).error, "replaceSourceChunks");
      // Insert in batches to stay well under request size limits on big files.
      for (let i = 0; i < chunks.length; i += 200) {
        fail((await admin().from("chunks").insert(chunkRows(subjectId, { source_id: sourceId }, chunks.slice(i, i + 200)))).error, "replaceSourceChunks");
      }
    },
    async uploadStats(sinceIso) {
      const [log, sources] = await Promise.all([
        db.from("upload_log").select("id", { count: "exact", head: true }).gte("created_at", sinceIso),
        db.from("sources").select("size_bytes"),
      ]);
      fail(log.error, "uploadStats");
      fail(sources.error, "uploadStats");
      return { countSince: log.count ?? 0, totalBytes: (sources.data ?? []).reduce((n, r) => n + (r.size_bytes as number), 0) };
    },
    async recordUpload(bytes) {
      fail((await admin().from("upload_log").insert({ user_id: userId, bytes })).error, "recordUpload");
    },
    async getProfile(): Promise<Profile> {
      const { data, error } = await db.from("profiles").select("sound_on, volume, theme").maybeSingle();
      fail(error, "getProfile");
      return data ? { soundOn: data.sound_on, volume: data.volume, theme: data.theme } : { soundOn: true, volume: 0.35, theme: "system" };
    },
    async updateProfile(patch) {
      const row: Row = { user_id: userId };
      if (patch.soundOn !== undefined) row.sound_on = patch.soundOn;
      if (patch.volume !== undefined) row.volume = patch.volume;
      if (patch.theme !== undefined) row.theme = patch.theme;
      fail((await db.from("profiles").upsert(row)).error, "updateProfile");
    },
    async exportAll(): Promise<ExportBundle> {
      const [subjects, notesRes, sourcesRes, chunksRes, profile] = await Promise.all([
        repo.listSubjects(),
        db.from("notes").select("*"),
        db.from("sources").select("*"),
        allSourceChunks(),
        repo.getProfile(),
      ]);
      fail(notesRes.error, "export notes");
      fail(sourcesRes.error, "export sources");
      const textBySource = new Map<string, string[]>();
      for (const c of chunksRes) {
        const list = textBySource.get(c.source_id as string) ?? [];
        list.push(c.text as string);
        textBySource.set(c.source_id as string, list);
      }
      return {
        exportedAt: new Date().toISOString(),
        profile,
        subjects,
        notes: (notesRes.data ?? []).map((r) => ({ ...toNoteSummary(r), contentJson: r.content_json, contentText: r.content_text })),
        sources: (sourcesRes.data ?? []).map((r) => ({ ...toSource(r), extractedText: (textBySource.get(r.id as string) ?? []).join("\n\n") })),
      };
    },
  };
  return repo;
}
