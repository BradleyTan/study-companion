import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { MindmapGraph } from "@/lib/ai/types";
import { planChunkSync, type Chunk } from "@/lib/extract/chunk";
import type { AttemptSlot } from "@/lib/quiz/order";
import type { WeakPrev } from "@/lib/quiz/weak";
import type { Rating, SrsState, SrsStateNum } from "@/lib/srs/scheduler";
import type { SubjectColour } from "@/lib/subjects";
import type {
  CardReview, ChatCitation, ChatFeedback, ChatRow, ChunkRow, ExportBundle, Flashcard, Mindmap, MindmapSources, Note, NoteSummary, Profile, Question, QuestionPatch, Quiz, QuizAnswer, QuizAttempt, Repo,
  Source, Subject, WeakTopic,
} from "./types";

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
  clientKey: (r.client_key as string | null) ?? null,
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

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);
const toQuiz = (r: Row): Quiz => ({
  id: r.id as string,
  subjectId: r.subject_id as string,
  title: r.title as string,
  kind: r.kind as Quiz["kind"],
  focus: r.focus as Quiz["focus"],
  requested: r.requested as number,
  sourceIds: (r.source_ids as string[] | null) ?? [],
  pageFrom: (r.page_from as number | null) ?? null,
  pageTo: (r.page_to as number | null) ?? null,
  inputHash: r.input_hash as string,
  createdAt: iso(r.created_at)!,
  deletedAt: iso(r.deleted_at),
});
const toQuestion = (r: Row): Question => ({
  id: r.id as string,
  quizId: r.quiz_id as string,
  subjectId: r.subject_id as string,
  ordinal: r.ordinal as number,
  type: r.type as Question["type"],
  prompt: r.prompt as string,
  options: (r.options_json as string[] | null) ?? null,
  correctIndex: (r.correct_index as number | null) ?? null,
  answer: r.answer as string,
  accepted: (r.accepted_json as string[] | null) ?? [],
  explanation: (r.explanation as string | null) ?? "",
  topic: r.topic as string,
  sourceQuote: (r.source_quote as string | null) ?? null,
  chunkId: (r.chunk_id as string | null) ?? null,
  noteId: (r.note_id as string | null) ?? null,
  sourceId: (r.source_id as string | null) ?? null,
  page: (r.page as number | null) ?? null,
  edited: r.edited as boolean,
  removedAt: iso(r.removed_at),
});
const questionPatchRow = (p: QuestionPatch): Row => {
  const row: Row = {};
  if (p.prompt !== undefined) row.prompt = p.prompt;
  if (p.options !== undefined) row.options_json = p.options;
  if (p.correctIndex !== undefined) row.correct_index = p.correctIndex;
  if (p.answer !== undefined) row.answer = p.answer;
  if (p.accepted !== undefined) row.accepted_json = p.accepted;
  if (p.explanation !== undefined) row.explanation = p.explanation;
  if (p.edited !== undefined) row.edited = p.edited;
  if (p.removedAt !== undefined) row.removed_at = p.removedAt;
  return row;
};
const toAttempt = (r: Row): QuizAttempt => ({
  id: r.id as string,
  quizId: r.quiz_id as string,
  subjectId: r.subject_id as string,
  order: (r.order_json as AttemptSlot[]) ?? [],
  startedAt: iso(r.started_at)!,
  finishedAt: iso(r.finished_at),
  score: (r.score as number | null) ?? null,
  total: (r.total as number | null) ?? null,
});
const toAnswer = (r: Row): QuizAnswer => ({
  id: r.id as string,
  attemptId: r.attempt_id as string,
  questionId: r.question_id as string,
  subjectId: r.subject_id as string,
  clientKey: r.client_key as string,
  given: (r.given as string | null) ?? "",
  choice: (r.choice as number | null) ?? null,
  dontKnow: r.dont_know as boolean,
  correct: r.correct as boolean,
  typo: r.typo as boolean,
  overridden: r.overridden as boolean,
  weakPrev: (r.weak_prev as WeakPrev | null) ?? null,
  answeredAt: iso(r.answered_at)!,
});
const toWeakTopic = (r: Row): WeakTopic => ({
  id: r.id as string,
  subjectId: r.subject_id as string,
  topic: r.topic as string,
  topicKey: r.topic_key as string,
  missCount: r.miss_count as number,
  rightStreak: r.right_streak as number,
  lastMissedAt: iso(r.last_missed_at),
  clearedAt: iso(r.cleared_at),
  chunkIds: (r.chunk_ids as string[] | null) ?? [],
  recent: (r.recent as boolean[] | null) ?? [],
  createdAt: iso(r.created_at)!,
});

const toChat = (r: Row): ChatRow => ({
  id: r.id as string,
  subjectId: r.subject_id as string,
  role: r.role as ChatRow["role"],
  kind: r.kind as ChatRow["kind"],
  content: r.content as string,
  citations: (r.citations_json as ChatCitation[] | null) ?? [],
  reveal: (r.reveal as string | null) ?? null,
  feedback: (r.feedback as ChatFeedback | null) ?? null,
  clientKey: (r.client_key as string | null) ?? null,
  replyTo: (r.reply_to as string | null) ?? null,
  createdAt: iso(r.created_at)!,
});
const CHAT_COLS = "id, subject_id, role, kind, content, citations_json, reveal, feedback, client_key, reply_to, created_at";

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

  // Every question of the student, answers included (secret key, pinned: see listQuestions).
  async function allQuestions(): Promise<Row[]> {
    const out: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin().from("questions").select("*").eq("user_id", userId).order("created_at").order("id").range(from, from + 999);
      fail(error, "export questions");
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
    async listPageChars(subjectId) {
      // Summed in the database (security review S2-9): counts only, RLS-scoped to the student.
      const out: { sourceId: string; page: number | null; chars: number }[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await db.rpc("source_page_chars", { p_subject_id: subjectId }).range(from, from + 999);
        fail(error, "listPageChars");
        const rows = (data ?? []) as { source_id: string; page: number | null; chars: number | string }[];
        out.push(...rows.map((r) => ({ sourceId: r.source_id, page: r.page, chars: Number(r.chars) })));
        if (rows.length < 1000) return out;
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
      const { data, error } = await admin().from("flashcards").insert(rows).select("*");
      fail(error, "createFlashcards");
      return (data ?? []).map(toFlashcard).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async updateFlashcardText(id, input) {
      fail((await admin().from("flashcards").update({ front: input.front, back: input.back, edited: true }).eq("id", id).eq("user_id", userId)).error, "updateFlashcardText");
    },
    async setFlashcardDeleted(id, deleted) {
      fail((await admin().from("flashcards").update({ deleted_at: deleted ? new Date().toISOString() : null }).eq("id", id).eq("user_id", userId)).error, "setFlashcardDeleted");
    },
    async setFlashcardSrs(id, srs) {
      fail((await admin().from("flashcards").update({ ...srsRow(srs), last_review_at: srs.lastReviewAt }).eq("id", id).eq("user_id", userId)).error, "setFlashcardSrs");
    },

    async addCardReview(input) {
      const row = {
        user_id: userId, flashcard_id: input.flashcardId, subject_id: input.subjectId, client_key: input.clientKey,
        rating: input.rating, prev_state: input.prevState, reviewed_at: input.reviewedAt, ...srsRow(input.srs),
      };
      const { data, error } = await admin().from("card_reviews").insert(row).select("*").single();
      if (error && (error as { code?: string }).code === "23505" && input.clientKey) {
        // Already saved by an earlier try whose answer got lost.
        const dup = await db.from("card_reviews").select("*").eq("client_key", input.clientKey).eq("user_id", userId).single();
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
      fail((await admin().from("card_reviews").delete().eq("id", id).eq("user_id", userId)).error, "deleteCardReview");
    },
    async countIntroducedSince(sinceIso) {
      const { count, error } = await db.from("card_reviews").select("id", { count: "exact", head: true }).eq("prev_state", 0).gte("reviewed_at", sinceIso);
      fail(error, "countIntroducedSince");
      return count ?? 0;
    },

    async countReviewsSince(sinceIso) {
      const { count, error } = await db.from("card_reviews").select("id", { count: "exact", head: true }).gte("reviewed_at", sinceIso);
      fail(error, "countReviewsSince");
      return count ?? 0;
    },

    async getMindmap(subjectId) {
      const { data, error } = await db.from("mindmaps").select("*").eq("subject_id", subjectId).maybeSingle();
      fail(error, "getMindmap");
      return data ? toMindmap(data) : null;
    },
    async saveMindmap(subjectId, input) {
      const t = new Date().toISOString();
      const { data, error } = await admin()
        .from("mindmaps")
        .upsert({ user_id: userId, subject_id: subjectId, graph_json: input.graph, input_hash: input.inputHash, sources_json: input.sources, created_at: t }, { onConflict: "subject_id,user_id" })
        .select("*")
        .single();
      fail(error, "saveMindmap");
      return toMindmap(data);
    },
    async updateMindmapGraph(subjectId, graph) {
      fail((await admin().from("mindmaps").update({ graph_json: graph }).eq("subject_id", subjectId).eq("user_id", userId)).error, "updateMindmapGraph");
    },

    async aiUsageCount(day, kind) {
      const { data, error } = await db.from("ai_usage").select("count").eq("day", day).eq("kind", kind).maybeSingle();
      fail(error, "aiUsageCount");
      return (data?.count as number | undefined) ?? 0;
    },
    async reserveAi(day, kind, limit, maxAttempts) {
      const { data, error } = await admin().rpc("ai_usage_reserve", { p_user_id: userId, p_day: day, p_kind: kind, p_limit: limit, p_max_attempts: maxAttempts });
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
      // Server-only table (a cached quiz holds its answers): secret key, pinned to the student.
      const { data, error } = await admin().from("ai_cache").select("model, output_json").eq("user_id", userId).eq("kind", kind).eq("input_hash", inputHash).maybeSingle();
      fail(error, "getAiCache");
      return data ? { model: data.model as string, output: data.output_json } : null;
    },
    async putAiCache(kind, inputHash, model, output) {
      const { error } = await admin().from("ai_cache").upsert({ user_id: userId, kind, input_hash: inputHash, model, output_json: output, created_at: new Date().toISOString() });
      fail(error, "putAiCache");
    },

    // ---- Step 3 ----
    // Questions are read with the secret key, pinned to the student: students can't read a
    // question's answer columns themselves (column grants), so answers reach the browser only
    // through the server, after the student has answered.
    async listQuizzes(subjectId) {
      const { data, error } = await db.from("quizzes").select("*").eq("subject_id", subjectId).is("deleted_at", null)
        .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(500);
      fail(error, "listQuizzes");
      return (data ?? []).map(toQuiz);
    },
    async getQuiz(id) {
      const { data, error } = await db.from("quizzes").select("*").eq("id", id).maybeSingle();
      fail(error, "getQuiz");
      return data ? toQuiz(data) : null;
    },
    async findQuizByHash(subjectId, inputHash) {
      const { data, error } = await db.from("quizzes").select("*").eq("subject_id", subjectId).eq("input_hash", inputHash).is("deleted_at", null)
        .order("created_at", { ascending: false }).limit(1);
      fail(error, "findQuizByHash");
      return data?.[0] ? toQuiz(data[0]) : null;
    },
    async countQuizzes(subjectId) {
      const { count, error } = await db.from("quizzes").select("id", { count: "exact", head: true }).eq("subject_id", subjectId);
      fail(error, "countQuizzes");
      return count ?? 0;
    },
    async createQuiz(input, questions) {
      const { data, error } = await admin().from("quizzes").insert({
        user_id: userId, subject_id: input.subjectId, title: input.title, kind: input.kind, focus: input.focus, requested: input.requested,
        source_ids: input.sourceIds, page_from: input.pageFrom, page_to: input.pageTo, input_hash: input.inputHash,
      }).select("*").single();
      fail(error, "createQuiz");
      const quiz = toQuiz(data);
      const rows = questions.map((q) => ({
        user_id: userId, quiz_id: quiz.id, subject_id: input.subjectId, ordinal: q.ordinal, type: q.type, prompt: q.prompt,
        options_json: q.options, correct_index: q.correctIndex, answer: q.answer, accepted_json: q.accepted, explanation: q.explanation,
        topic: q.topic, source_quote: q.sourceQuote, chunk_id: q.chunkId, note_id: q.noteId, source_id: q.sourceId, page: q.page,
      }));
      const ins = rows.length ? await admin().from("questions").insert(rows).select("*") : { data: [], error: null };
      if (ins.error) {
        // No half-made quizzes: take the quiz row back out.
        await admin().from("quizzes").delete().eq("id", quiz.id).eq("user_id", userId);
        fail(ins.error, "createQuiz questions");
      }
      return { quiz, questions: (ins.data ?? []).map(toQuestion).sort((a, b) => a.ordinal - b.ordinal) };
    },
    async setQuizDeleted(id, deleted) {
      fail((await admin().from("quizzes").update({ deleted_at: deleted ? new Date().toISOString() : null }).eq("id", id).eq("user_id", userId)).error, "setQuizDeleted");
    },
    async purgeDeletedQuizzes(subjectId, beforeIso) {
      fail((await admin().from("quizzes").delete().eq("subject_id", subjectId).eq("user_id", userId).lt("deleted_at", beforeIso)).error, "purgeDeletedQuizzes");
    },
    async listQuestions(filter) {
      const out: Question[] = [];
      for (let from = 0; ; from += 1000) {
        let q = admin().from("questions").select("*").eq("user_id", userId);
        q = "quizId" in filter ? q.eq("quiz_id", filter.quizId)
          : "quizIds" in filter ? q.in("quiz_id", filter.quizIds.length ? filter.quizIds.slice(0, 500) : ["00000000-0000-0000-0000-000000000000"])
          : q.eq("subject_id", filter.subjectId).eq("topic_key", filter.topicKey);
        const { data, error } = await q.order("quiz_id").order("ordinal").range(from, from + 999);
        fail(error, "listQuestions");
        out.push(...(data ?? []).map(toQuestion));
        if (!data || data.length < 1000) return out;
      }
    },
    async getQuestion(id) {
      const { data, error } = await admin().from("questions").select("*").eq("id", id).eq("user_id", userId).maybeSingle();
      fail(error, "getQuestion");
      return data ? toQuestion(data) : null;
    },
    async updateQuestion(id, patch) {
      fail((await admin().from("questions").update(questionPatchRow(patch)).eq("id", id).eq("user_id", userId)).error, "updateQuestion");
    },
    async listAttempts(filter) {
      const out: QuizAttempt[] = [];
      for (let from = 0; ; from += 1000) {
        let q = db.from("quiz_attempts").select("*");
        q = "quizId" in filter ? q.eq("quiz_id", filter.quizId) : q.eq("subject_id", filter.subjectId);
        const { data, error } = await q.order("started_at", { ascending: false }).order("id", { ascending: false }).range(from, from + 999);
        fail(error, "listAttempts");
        out.push(...(data ?? []).map(toAttempt));
        if (!data || data.length < 1000) return out;
      }
    },
    async getAttempt(id) {
      const { data, error } = await db.from("quiz_attempts").select("*").eq("id", id).maybeSingle();
      fail(error, "getAttempt");
      return data ? toAttempt(data) : null;
    },
    async createAttempt(input) {
      const { data, error } = await admin().from("quiz_attempts")
        .insert({ user_id: userId, quiz_id: input.quizId, subject_id: input.subjectId, order_json: input.order }).select("*").single();
      fail(error, "createAttempt");
      return toAttempt(data);
    },
    async deleteAttempts(ids) {
      if (!ids.length) return;
      fail((await admin().from("quiz_attempts").delete().in("id", ids).eq("user_id", userId)).error, "deleteAttempts");
    },
    async updateAttempt(id, patch) {
      const row: Row = {};
      if (patch.finishedAt !== undefined) row.finished_at = patch.finishedAt;
      if (patch.score !== undefined) row.score = patch.score;
      if (patch.total !== undefined) row.total = patch.total;
      fail((await admin().from("quiz_attempts").update(row).eq("id", id).eq("user_id", userId)).error, "updateAttempt");
    },
    async listAnswers(filter) {
      const ids = "attemptIds" in filter ? filter.attemptIds : filter.questionIds;
      const col = "attemptIds" in filter ? "attempt_id" : "question_id";
      const out: QuizAnswer[] = [];
      for (let i = 0; i < ids.length; i += 200) {
        const { data, error } = await db.from("answers").select("*").in(col, ids.slice(i, i + 200)).order("answered_at").limit(5000);
        fail(error, "listAnswers");
        out.push(...(data ?? []).map(toAnswer));
      }
      return out.sort((a, b) => a.answeredAt.localeCompare(b.answeredAt));
    },
    async addAnswer(input) {
      const existing = await db.from("answers").select("*").eq("attempt_id", input.attemptId).eq("question_id", input.questionId).maybeSingle();
      fail(existing.error, "addAnswer");
      if (existing.data) return { answer: toAnswer(existing.data), created: false };
      const { data, error } = await admin().from("answers").insert({
        user_id: userId, attempt_id: input.attemptId, question_id: input.questionId, subject_id: input.subjectId, client_key: input.clientKey,
        given: input.given, choice: input.choice, dont_know: input.dontKnow, correct: input.correct, typo: input.typo, overridden: input.overridden,
        weak_prev: input.weakPrev,
      }).select("*").single();
      if (error && (error as { code?: string }).code === "23505") {
        // Saved by an earlier try whose reply got lost (same key, or same question in this attempt).
        const dup = await db.from("answers").select("*")
          .or(`client_key.eq.${input.clientKey},and(attempt_id.eq.${input.attemptId},question_id.eq.${input.questionId})`).limit(1);
        fail(dup.error, "addAnswer");
        if (dup.data?.[0]) return { answer: toAnswer(dup.data[0]), created: false };
      }
      fail(error, "addAnswer");
      return { answer: toAnswer(data), created: true };
    },
    async updateAnswer(id, patch) {
      const row: Row = {};
      if (patch.correct !== undefined) row.correct = patch.correct;
      if (patch.overridden !== undefined) row.overridden = patch.overridden;
      fail((await admin().from("answers").update(row).eq("id", id).eq("user_id", userId)).error, "updateAnswer");
    },
    async listWeakTopics(subjectId) {
      const { data, error } = await db.from("weak_topics").select("*").eq("subject_id", subjectId).limit(1000);
      fail(error, "listWeakTopics");
      return (data ?? []).map(toWeakTopic);
    },
    async getWeakTopic(id) {
      const { data, error } = await db.from("weak_topics").select("*").eq("id", id).maybeSingle();
      fail(error, "getWeakTopic");
      return data ? toWeakTopic(data) : null;
    },
    async findWeakTopic(subjectId, key) {
      const { data, error } = await db.from("weak_topics").select("*").eq("subject_id", subjectId).eq("topic_key", key).maybeSingle();
      fail(error, "findWeakTopic");
      return data ? toWeakTopic(data) : null;
    },
    async saveWeakTopic(subjectId, state, id) {
      const row = {
        topic: state.topic, miss_count: state.missCount, right_streak: state.rightStreak, last_missed_at: state.lastMissedAt,
        cleared_at: state.clearedAt, chunk_ids: state.chunkIds, recent: state.recent,
      };
      const res = id
        ? await admin().from("weak_topics").update(row).eq("id", id).eq("user_id", userId).select("*").single()
        : await admin().from("weak_topics").insert({ ...row, user_id: userId, subject_id: subjectId }).select("*").single();
      fail(res.error, "saveWeakTopic");
      return toWeakTopic(res.data);
    },
    async deleteWeakTopic(id) {
      fail((await admin().from("weak_topics").delete().eq("id", id).eq("user_id", userId)).error, "deleteWeakTopic");
    },

    // ---- Step 3 part 2 ----
    // Retrieval runs as the student (RLS + the functions' own user_id = auth.uid() filter).
    // Chat rows are read with the student's session and written with the secret key, pinned.
    async matchChunks(subjectId, embedding, limit) {
      const { data, error } = await db.rpc("match_chunks", { p_subject_id: subjectId, p_embedding: JSON.stringify(embedding), p_count: limit });
      fail(error, "matchChunks");
      return ((data ?? []) as Row[]).map((r) => ({ ...toChunk(r), similarity: Number(r.similarity) }));
    },
    async searchChunks(subjectId, query, limit, opts = {}) {
      const { data, error } = await db.rpc("search_chunks", { p_subject_id: subjectId, p_query: query, p_count: limit, p_unembedded_only: !!opts.unembeddedOnly });
      fail(error, "searchChunks");
      return ((data ?? []) as Row[]).map(toChunk);
    },
    async embeddingCounts(subjectId) {
      const [all, done] = await Promise.all([
        db.from("chunks").select("id", { count: "exact", head: true }).eq("subject_id", subjectId),
        db.from("chunks").select("id", { count: "exact", head: true }).eq("subject_id", subjectId).not("embedding", "is", null),
      ]);
      fail(all.error, "embeddingCounts");
      fail(done.error, "embeddingCounts");
      return { total: all.count ?? 0, embedded: done.count ?? 0 };
    },
    async listChat(subjectId, { limit, before }) {
      let q = db.from("chat_messages").select(CHAT_COLS).eq("subject_id", subjectId);
      if (before) q = q.lt("created_at", before);
      const { data, error } = await q.order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit);
      fail(error, "listChat");
      return (data ?? []).map(toChat);
    },
    async getChatMessage(id) {
      const { data, error } = await db.from("chat_messages").select(CHAT_COLS).eq("id", id).maybeSingle();
      fail(error, "getChatMessage");
      return data ? toChat(data) : null;
    },
    async findChatExchange(clientKey) {
      const { data, error } = await db.from("chat_messages").select(CHAT_COLS).eq("client_key", clientKey).maybeSingle();
      fail(error, "findChatExchange");
      if (!data) return null;
      const question = toChat(data);
      const ans = await db.from("chat_messages").select(CHAT_COLS).eq("reply_to", question.id).maybeSingle();
      fail(ans.error, "findChatExchange");
      return { question, answer: ans.data ? toChat(ans.data) : null };
    },
    async addChatExchange(subjectId, { clientKey, question, answer, after }) {
      const at = Math.max(Date.now(), after ? Date.parse(after) + 1 : 0);
      const qid = crypto.randomUUID();
      // One statement, so the answer's reply_to finds its question and nothing is half-saved.
      const { data, error } = await admin().from("chat_messages").insert([
        // Every column on both rows: in a multi-row insert a missing column is sent as null.
        {
          id: qid, user_id: userId, subject_id: subjectId, role: "user", kind: "question", content: question, citations_json: [],
          reveal: null, client_key: clientKey, reply_to: null, created_at: new Date(at).toISOString(),
        },
        {
          id: crypto.randomUUID(), user_id: userId, subject_id: subjectId, role: "assistant", kind: answer.kind, content: answer.content,
          citations_json: answer.citations, reveal: answer.reveal, client_key: null, reply_to: qid, created_at: new Date(at + 1).toISOString(),
        },
      ]).select(CHAT_COLS);
      fail(error, "addChatExchange");
      const rows = (data ?? []).map(toChat);
      return { question: rows.find((r) => r.role === "user")!, answer: rows.find((r) => r.role === "assistant")! };
    },
    async setChatFeedback(id, feedback) {
      fail((await admin().from("chat_messages").update({ feedback }).eq("id", id).eq("user_id", userId).eq("role", "assistant")).error, "setChatFeedback");
    },
    async clearChat(subjectId) {
      fail((await admin().from("chat_messages").delete().eq("subject_id", subjectId).eq("user_id", userId)).error, "clearChat");
    },
    async countChat(subjectId) {
      const { count, error } = await db.from("chat_messages").select("id", { count: "exact", head: true }).eq("subject_id", subjectId);
      fail(error, "countChat");
      return count ?? 0;
    },
    async deleteOldestChat(subjectId, questions) {
      const { data, error } = await db.from("chat_messages").select("id").eq("subject_id", subjectId).eq("role", "user")
        .order("created_at").order("id").limit(questions);
      fail(error, "deleteOldestChat");
      const ids = (data ?? []).map((r) => r.id as string);
      // Answers go with their questions (reply_to cascades).
      if (ids.length) fail((await admin().from("chat_messages").delete().in("id", ids).eq("user_id", userId)).error, "deleteOldestChat");
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
      const [subjects, notesRes, sourcesRes, chunksRes, profile, cardsRes, reviewsRes, mapsRes, quizzesRes, attemptsRes, answersRes, weakRes, questionsRes, chatRes] = await Promise.all([
        repo.listSubjects(),
        db.from("notes").select("*"),
        db.from("sources").select("*"),
        allSourceChunks(),
        repo.getProfile(),
        allRows("flashcards", "created_at"),
        allRows("card_reviews", "reviewed_at"),
        allRows("mindmaps", "created_at"),
        allRows("quizzes", "created_at"),
        allRows("quiz_attempts", "started_at"),
        allRows("answers", "answered_at"),
        allRows("weak_topics", "created_at"),
        allQuestions(),
        allRows("chat_messages", "created_at"),
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
        quizzes: quizzesRes.map(toQuiz),
        questions: questionsRes.map(toQuestion),
        quizAttempts: attemptsRes.map(toAttempt),
        answers: answersRes.map(toAnswer),
        weakTopics: weakRes.map(toWeakTopic),
        chatMessages: chatRes.map(toChat),
      };
    },
  };
  return repo;
}
