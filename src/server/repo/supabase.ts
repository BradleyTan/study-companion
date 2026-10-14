import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MindmapGraph } from "@/lib/ai/types";
import { planChunkSync, type Chunk } from "@/lib/extract/chunk";
import type { Rating, SrsState, SrsStateNum } from "@/lib/srs/scheduler";
import type { SubjectColour } from "@/lib/subjects";
import type { CardReview, ChunkRow, ExportBundle, Flashcard, Mindmap, MindmapSources, Note, NoteSummary, Profile, Repo, Source, Subject } from "./types";

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
  chars: ((r.title as string | undefined) ?? "").length + ((r.content_text as string | undefined) ?? "").length,
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

const toChunk = (r: Row): ChunkRow => ({
  id: r.id as string,
  subjectId: r.subject_id as string,
  noteId: (r.note_id as string | null) ?? null,
  sourceId: (r.source_id as string | null) ?? null,
  ordinal: r.ordinal as number,
  page: (r.page as number | null) ?? null,
  text: r.text as string,
  contentHash: r.content_hash as string,
});
const toSrs = (r: Row): SrsState => ({
  state: r.srs_state as SrsStateNum,
  dueAt: new Date(r.due_at as string).toISOString(),
  stability: Number(r.stability),
  difficulty: Number(r.difficulty),
  elapsedDays: r.elapsed_days as number,
  scheduledDays: r.scheduled_days as number,
  learningSteps: r.learning_steps as number,
  reps: r.reps as number,
  lapses: r.lapses as number,
  lastReviewAt: r.last_review_at ? new Date(r.last_review_at as string).toISOString() : null,
});
const srsRow = (s: SrsState) => ({
  srs_state: s.state, due_at: s.dueAt, stability: s.stability, difficulty: s.difficulty, elapsed_days: s.elapsedDays,
  scheduled_days: s.scheduledDays, learning_steps: s.learningSteps, reps: s.reps, lapses: s.lapses,
});
const toFlashcard = (r: Row): Flashcard => ({
  id: r.id as string,
  subjectId: r.subject_id as string,
  front: r.front as string,
  back: r.back as string,
  sourceQuote: (r.source_quote as string | null) ?? null,
  origin: r.origin as Flashcard["origin"],
  edited: r.edited as boolean,
  createdAt: new Date(r.created_at as string).toISOString(),
  chunkId: (r.chunk_id as string | null) ?? null,
  noteId: (r.note_id as string | null) ?? null,
  sourceId: (r.source_id as string | null) ?? null,
  page: (r.page as number | null) ?? null,
  inputHash: (r.input_hash as string | null) ?? null,
  deletedAt: (r.deleted_at as string | null) ?? null,
  srs: toSrs(r),
});
const toReview = (r: Row): CardReview => ({
  id: r.id as string,
  flashcardId: r.flashcard_id as string,
  subjectId: r.subject_id as string,
  rating: r.rating as Rating,
  prevState: r.prev_state as SrsStateNum,
  reviewedAt: new Date(r.reviewed_at as string).toISOString(),
  srs: { ...toSrs(r), lastReviewAt: new Date(r.reviewed_at as string).toISOString() },
});
const toMindmap = (r: Row): Mindmap => ({
  id: r.id as string,
  subjectId: r.subject_id as string,
  graph: r.graph_json as MindmapGraph,
  inputHash: r.input_hash as string,
  sources: r.sources_json as MindmapSources,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

const CHUNK_COLS = "id, subject_id, note_id, source_id, ordinal, page, text, content_hash";
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

  // Every row of a table (RLS limits it to this student), paged past PostgREST's 1,000-row cap.
  async function allRows(table: string, orderBy: string): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await db.from(table).select("*").order(orderBy).order("id").range(from, from + 999);
      fail(error, `export ${table}`);
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
      // Keep unchanged passages (and their ids, which cards and mindmap nodes point at).
      const cur = await admin().from("chunks").select("id, ordinal, page, content_hash").eq("note_id", noteId).eq("user_id", userId);
      fail(cur.error, "replaceNoteChunks");
      const existing = (cur.data ?? []).map((r) => ({ id: r.id as string, ordinal: r.ordinal as number, page: (r.page as number | null) ?? null, contentHash: r.content_hash as string }));
      const plan = planChunkSync(existing, chunks);
      if (plan.remove.length) fail((await admin().from("chunks").delete().in("id", plan.remove).eq("user_id", userId)).error, "replaceNoteChunks");
      const before = new Map(existing.map((c) => [c.id, c.ordinal]));
      for (const k of plan.keep) {
        if (before.get(k.id) === k.ordinal) continue;
        fail((await admin().from("chunks").update({ ordinal: k.ordinal }).eq("id", k.id).eq("user_id", userId)).error, "replaceNoteChunks");
      }
      if (plan.insert.length) fail((await admin().from("chunks").insert(chunkRows(subjectId, { note_id: noteId }, plan.insert))).error, "replaceNoteChunks");
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
    async listChunks(filter) {
      const out: ChunkRow[] = [];
      for (let from = 0; ; from += 1000) {
        let q = db.from("chunks").select(CHUNK_COLS);
        q = "noteId" in filter ? q.eq("note_id", filter.noteId) : "sourceId" in filter ? q.eq("source_id", filter.sourceId) : q.eq("subject_id", filter.subjectId);
        const { data, error } = await q.order("ordinal").order("id").range(from, from + 999);
        fail(error, "listChunks");
        out.push(...(data ?? []).map(toChunk));
        if (!data || data.length < 1000) return out;
      }
    },
    async getChunks(ids) {
      if (!ids.length) return [];
      const out: ChunkRow[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await db.from("chunks").select(CHUNK_COLS).in("id", ids.slice(i, i + 200));
        fail(error, "getChunks");
        out.push(...(data ?? []).map(toChunk));
      }
      return out;
    },

    async listFlashcards(filter = {}) {
      const out: Flashcard[] = [];
      for (let from = 0; ; from += 1000) {
        let q = db.from("flashcards").select("*").is("deleted_at", null);
        if (filter.subjectId) q = q.eq("subject_id", filter.subjectId);
        const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).range(from, from + 999);
        fail(error, "listFlashcards");
        out.push(...(data ?? []).map(toFlashcard));
        if (!data || data.length < 1000) return out;
      }
    },
    async getFlashcard(id) {
      const { data, error } = await db.from("flashcards").select("*").eq("id", id).maybeSingle();
      fail(error, "getFlashcard");
      return data ? toFlashcard(data) : null;
    },
    async findFlashcardsByHash(inputHash) {
      const { data, error } = await db.from("flashcards").select("*").eq("input_hash", inputHash).is("deleted_at", null).order("created_at", { ascending: false });
      fail(error, "findFlashcardsByHash");
      return (data ?? []).map(toFlashcard);
    },
    async createFlashcards(cards) {
      if (!cards.length) return [];
      const t = Date.now();
      const rows = cards.map((c, i) => ({
        user_id: userId, subject_id: c.subjectId, front: c.front, back: c.back, origin: c.origin,
        source_quote: c.sourceQuote ?? null, chunk_id: c.chunkId ?? null, note_id: c.noteId ?? null, source_id: c.sourceId ?? null,
        page: c.page ?? null, input_hash: c.inputHash ?? null,
        // Stable order within a batch: the first card is the newest. New cards are due straight away.
        created_at: new Date(t - i).toISOString(), due_at: new Date(t - i).toISOString(),
      }));
      const { data, error } = await db.from("flashcards").insert(rows).select("*");
      fail(error, "createFlashcards");
      return (data ?? []).map(toFlashcard).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async updateFlashcardText(id, input) {
      fail((await db.from("flashcards").update({ front: input.front, back: input.back, edited: true }).eq("id", id)).error, "updateFlashcardText");
    },
    async setFlashcardDeleted(id, deleted) {
      fail((await db.from("flashcards").update({ deleted_at: deleted ? new Date().toISOString() : null }).eq("id", id)).error, "setFlashcardDeleted");
    },
    async setFlashcardSrs(id, srs) {
      fail((await db.from("flashcards").update({ ...srsRow(srs), last_review_at: srs.lastReviewAt }).eq("id", id)).error, "setFlashcardSrs");
    },

    async addCardReview(input) {
      const row = {
        user_id: userId, flashcard_id: input.flashcardId, subject_id: input.subjectId, client_key: input.clientKey,
        rating: input.rating, prev_state: input.prevState, reviewed_at: input.reviewedAt, ...srsRow(input.srs),
      };
      const { data, error } = await db.from("card_reviews").insert(row).select("*").single();
      if (error && (error as { code?: string }).code === "23505" && input.clientKey) {
        // Already saved by an earlier try whose answer got lost.
        const dup = await db.from("card_reviews").select("*").eq("client_key", input.clientKey).single();
        fail(dup.error, "addCardReview");
        return toReview(dup.data);
      }
      fail(error, "addCardReview");
      return toReview(data);
    },
    async latestReviews(flashcardId, limit) {
      const { data, error } = await db.from("card_reviews").select("*").eq("flashcard_id", flashcardId).order("reviewed_at", { ascending: false }).limit(limit);
      fail(error, "latestReviews");
      return (data ?? []).map(toReview);
    },
    async deleteCardReview(id) {
      fail((await db.from("card_reviews").delete().eq("id", id)).error, "deleteCardReview");
    },
    async countIntroducedSince(sinceIso) {
      const { count, error } = await db.from("card_reviews").select("id", { count: "exact", head: true }).eq("prev_state", 0).gte("reviewed_at", sinceIso);
      fail(error, "countIntroducedSince");
      return count ?? 0;
    },

    async getMindmap(subjectId) {
      const { data, error } = await db.from("mindmaps").select("*").eq("subject_id", subjectId).maybeSingle();
      fail(error, "getMindmap");
      return data ? toMindmap(data) : null;
    },
    async saveMindmap(subjectId, input) {
      const t = new Date().toISOString();
      const { data, error } = await db
        .from("mindmaps")
        .upsert({ user_id: userId, subject_id: subjectId, graph_json: input.graph, input_hash: input.inputHash, sources_json: input.sources, created_at: t }, { onConflict: "subject_id,user_id" })
        .select("*")
        .single();
      fail(error, "saveMindmap");
      return toMindmap(data);
    },
    async updateMindmapGraph(subjectId, graph) {
      fail((await db.from("mindmaps").update({ graph_json: graph }).eq("subject_id", subjectId)).error, "updateMindmapGraph");
    },

    async aiUsageCount(day, kind) {
      const { data, error } = await db.from("ai_usage").select("count").eq("day", day).eq("kind", kind).maybeSingle();
      fail(error, "aiUsageCount");
      return (data?.count as number | undefined) ?? 0;
    },
    async reserveAi(day, kind, limit) {
      const { data, error } = await admin().rpc("ai_usage_reserve", { p_user_id: userId, p_day: day, p_kind: kind, p_limit: limit });
      fail(error, "reserveAi");
      return data !== null;
    },
    async settleAi(day, kind, ok, inputTokens, outputTokens) {
      const { error } = await admin().rpc("ai_usage_settle", { p_user_id: userId, p_day: day, p_kind: kind, p_ok: ok, p_input_tokens: inputTokens, p_output_tokens: outputTokens });
      fail(error, "settleAi");
    },
    async reserveAppBudget(day, model, maxRequests, maxTokens) {
      const { data, error } = await admin().rpc("ai_app_reserve", { p_day: day, p_model: model, p_max_requests: maxRequests, p_max_tokens: maxTokens });
      fail(error, "reserveAppBudget");
      return data === true;
    },
    async addAppTokens(day, model, tokens) {
      fail((await admin().rpc("ai_app_add_tokens", { p_day: day, p_model: model, p_tokens: tokens })).error, "addAppTokens");
    },
    async appBudgetLeft(day, model, maxRequests, maxTokens) {
      const { data, error } = await admin().from("ai_app_usage").select("requests, tokens").eq("day", day).eq("model", model).maybeSingle();
      fail(error, "appBudgetLeft");
      return !data || ((data.requests as number) < maxRequests && (data.tokens as number) < maxTokens);
    },
    async getAiCache(kind, inputHash) {
      const { data, error } = await db.from("ai_cache").select("model, output_json").eq("kind", kind).eq("input_hash", inputHash).maybeSingle();
      fail(error, "getAiCache");
      return data ? { model: data.model as string, output: data.output_json } : null;
    },
    async putAiCache(kind, inputHash, model, output) {
      const { error } = await admin().from("ai_cache").upsert({ user_id: userId, kind, input_hash: inputHash, model, output_json: output, created_at: new Date().toISOString() });
      fail(error, "putAiCache");
    },

    async getProfile(): Promise<Profile> {
      const { data, error } = await db.from("profiles").select("sound_on, volume, theme, timezone").maybeSingle();
      fail(error, "getProfile");
      return data
        ? { soundOn: data.sound_on, volume: data.volume, theme: data.theme, timezone: data.timezone }
        : { soundOn: true, volume: 0.35, theme: "system", timezone: "UTC" };
    },
    async updateProfile(patch) {
      const row: Row = { user_id: userId };
      if (patch.soundOn !== undefined) row.sound_on = patch.soundOn;
      if (patch.volume !== undefined) row.volume = patch.volume;
      if (patch.theme !== undefined) row.theme = patch.theme;
      if (patch.timezone !== undefined) row.timezone = patch.timezone;
      fail((await db.from("profiles").upsert(row)).error, "updateProfile");
    },
    async exportAll(): Promise<ExportBundle> {
      const [subjects, notesRes, sourcesRes, chunksRes, profile, cardsRes, reviewsRes, mapsRes] = await Promise.all([
        repo.listSubjects(),
        db.from("notes").select("*"),
        db.from("sources").select("*"),
        allSourceChunks(),
        repo.getProfile(),
        allRows("flashcards", "created_at"),
        allRows("card_reviews", "reviewed_at"),
        allRows("mindmaps", "created_at"),
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
        flashcards: cardsRes.map(toFlashcard),
        cardReviews: reviewsRes.map(toReview),
        mindmaps: mapsRes.map(toMindmap),
      };
    },
  };
  return repo;
}
