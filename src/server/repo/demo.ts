import "server-only";
import { planChunkSync, type Chunk } from "@/lib/extract/chunk";
import { newSrs } from "@/lib/srs/scheduler";
import type { SettingsUpdate } from "@/lib/validation";
import { topicKey } from "@/lib/quiz/weak";
import { rankByKeywords } from "@/lib/chat/retrieve";
import type { CardReview, ChatRow, ChunkRow, ExportBundle, Flashcard, Mindmap, Note, Profile, Question, Quiz, QuizAnswer, QuizAttempt, Repo, Source, StudySession, Subject, WeakTopic } from "./types";

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
  quizzes: Map<string, Owned<Quiz>>;
  questions: Map<string, Owned<Question>>;
  attempts: Map<string, Owned<QuizAttempt>>;
  answers: Map<string, Owned<QuizAnswer>>;
  weakTopics: Map<string, Owned<WeakTopic>>;
  chat: Map<string, Owned<ChatRow>>;
  studySessions: Map<string, Owned<StudySession>>;
};
const g = globalThis as unknown as { __demoStore?: Store };
export const store: Store = (g.__demoStore ??= {
  subjects: new Map(), notes: new Map(), sources: new Map(), chunks: new Map(), files: new Map(), profiles: new Map(), uploadLog: [],
  flashcards: new Map(), reviews: new Map(), mindmaps: new Map(), aiUsage: new Map(), appUsage: new Map(), aiCache: new Map(),
  quizzes: new Map(), questions: new Map(), attempts: new Map(), answers: new Map(), weakTopics: new Map(), chat: new Map(), studySessions: new Map(),
});
// A store created by an older build (hot reload) may miss the Step 2 and Step 3 maps.
for (const k of ["flashcards", "reviews", "mindmaps", "aiUsage", "appUsage", "aiCache", "quizzes", "questions", "attempts", "answers", "weakTopics", "chat", "studySessions"] as const) store[k] ??= new Map() as never;

const now = () => new Date().toISOString();
/** Same cap as the database (1000 chat messages per subject). */
const CHAT_CAP = 1000;
/** Same cap as the database (10,000 study sessions per student). */
const STUDY_SESSION_CAP = 10_000;
const DEFAULT_PROFILE: Profile = {
  soundOn: true, volume: 0.35, theme: "system", timezone: "UTC",
  timerFocusMin: 25, timerShortMin: 5, timerLongMin: 15, timerLongEvery: 4, timerAutoStart: false, focusQuiet: true,
};
const clone = <T>(v: T): T => structuredClone(v);

/** What deleting a note or file does to cards and passages (mirrors the SQL foreign keys). */
function dropChunks(ownerId: string, link: "noteId" | "sourceId") {
  const gone = new Set((store.chunks.get(ownerId) ?? []).map((c) => c.id));
  store.chunks.delete(ownerId);
  for (const f of [...store.flashcards.values(), ...store.questions.values()]) {
    if (f.chunkId && gone.has(f.chunkId)) f.chunkId = null;
    if (f[link] === ownerId) f[link] = null;
  }
}

/** Deletes a quiz and everything under it (mirrors the SQL cascades). */
function dropQuiz(quizId: string) {
  store.quizzes.delete(quizId);
  for (const [k, q] of store.questions) if (q.quizId === quizId) store.questions.delete(k);
  for (const [k, a] of store.attempts) if (a.quizId === quizId) dropAttempt(k);
}
function dropAttempt(attemptId: string) {
  store.attempts.delete(attemptId);
  for (const [k, a] of store.answers) if (a.attemptId === attemptId) store.answers.delete(k);
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
      for (const [k, q] of store.quizzes) if (q.subjectId === id) dropQuiz(k);
      for (const [k, w] of store.weakTopics) if (w.subjectId === id) store.weakTopics.delete(k);
      for (const [k, m] of store.chat) if (m.subjectId === id) store.chat.delete(k);
      // Study time stays, as "No subject" (on delete set null in the database).
      for (const ss of store.studySessions.values()) if (ss.userId === userId && ss.subjectId === id) ss.subjectId = null;
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
      for (const f of [...store.flashcards.values(), ...store.questions.values()]) if (f.chunkId && removed.has(f.chunkId)) f.chunkId = null;
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
    async listPageChars(subjectId) {
      const sums = new Map<string, { sourceId: string; page: number | null; chars: number }>();
      for (const c of myChunks()) {
        if (c.subjectId !== subjectId || !c.sourceId) continue;
        const key = `${c.sourceId}|${c.page}`;
        const row = sums.get(key) ?? { sourceId: c.sourceId, page: c.page, chars: 0 };
        row.chars += c.text.length;
        sums.set(key, row);
      }
      return [...sums.values()];
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

    // ---- Step 3 ----
    async listQuizzes(subjectId) {
      return [...store.quizzes.values()]
        .filter((q) => q.userId === userId && q.subjectId === subjectId && !q.deletedAt)
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .map(strip);
    },
    async getQuiz(id) {
      const q = own(store.quizzes.get(id));
      return q ? strip(q) : null;
    },
    async findQuizByHash(subjectId, inputHash) {
      return (await repo.listQuizzes(subjectId)).find((q) => q.inputHash === inputHash) ?? null;
    },
    async countQuizzes(subjectId) {
      return [...store.quizzes.values()].filter((q) => q.userId === userId && q.subjectId === subjectId).length;
    },
    async createQuiz(input, questions) {
      if (!own(store.subjects.get(input.subjectId))) throw new Error("Subject not found");
      if (questions.length > 20) throw new Error("question limit reached");
      const mineChunks = new Set(myChunks().map((c) => c.id));
      for (const q of questions) if (q.chunkId && !mineChunks.has(q.chunkId)) throw new Error("Passage not found");
      const quiz: Owned<Quiz> = { ...clone(input), id: crypto.randomUUID(), userId, createdAt: now(), deletedAt: null };
      store.quizzes.set(quiz.id, quiz);
      const rows = questions.map((q): Owned<Question> => ({
        ...clone(q), id: crypto.randomUUID(), userId, quizId: quiz.id, subjectId: input.subjectId, edited: false, removedAt: null,
      }));
      for (const r of rows) store.questions.set(r.id, r);
      return { quiz: strip(quiz), questions: rows.map(strip) };
    },
    async setQuizDeleted(id, deleted) {
      const q = own(store.quizzes.get(id));
      if (q) q.deletedAt = deleted ? now() : null;
    },
    async purgeDeletedQuizzes(subjectId, beforeIso) {
      for (const [k, q] of store.quizzes) if (q.userId === userId && q.subjectId === subjectId && q.deletedAt && q.deletedAt < beforeIso) dropQuiz(k);
    },
    async listQuestions(filter) {
      const match = (q: Owned<Question>) =>
        "quizId" in filter ? q.quizId === filter.quizId
        : "quizIds" in filter ? filter.quizIds.includes(q.quizId)
        : q.subjectId === filter.subjectId && topicKey(q.topic) === filter.topicKey;
      return [...store.questions.values()]
        .filter((q) => q.userId === userId && match(q))
        .sort((a, b) => a.quizId.localeCompare(b.quizId) || a.ordinal - b.ordinal)
        .map(strip);
    },
    async getQuestion(id) {
      const q = own(store.questions.get(id));
      return q ? strip(q) : null;
    },
    async updateQuestion(id, patch) {
      const q = own(store.questions.get(id));
      if (q) Object.assign(q, clone(patch));
    },
    async listAttempts(filter) {
      return [...store.attempts.values()]
        .filter((a) => a.userId === userId && ("quizId" in filter ? a.quizId === filter.quizId : a.subjectId === filter.subjectId))
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.id.localeCompare(a.id))
        .map(strip);
    },
    async getAttempt(id) {
      const a = own(store.attempts.get(id));
      return a ? strip(a) : null;
    },
    async createAttempt(input) {
      const quiz = own(store.quizzes.get(input.quizId));
      if (!quiz || quiz.subjectId !== input.subjectId) throw new Error("Quiz not found");
      if ([...store.attempts.values()].filter((a) => a.quizId === input.quizId).length >= 50) throw new Error("attempt limit reached");
      // Strictly increasing start times, so "newest first" is stable within one millisecond.
      const last = [...store.attempts.values()].filter((a) => a.userId === userId).reduce((m, a) => (a.startedAt > m ? a.startedAt : m), "");
      let t = now();
      if (t <= last) t = new Date(Date.parse(last) + 1).toISOString();
      const a: Owned<QuizAttempt> = { id: crypto.randomUUID(), userId, quizId: input.quizId, subjectId: input.subjectId, order: clone(input.order), startedAt: t, finishedAt: null, score: null, total: null };
      store.attempts.set(a.id, a);
      return strip(a);
    },
    async deleteAttempts(ids) {
      for (const id of ids) if (own(store.attempts.get(id))) dropAttempt(id);
    },
    async updateAttempt(id, patch) {
      const a = own(store.attempts.get(id));
      if (a) Object.assign(a, patch);
    },
    async listAnswers(filter) {
      const want = new Set("attemptIds" in filter ? filter.attemptIds : filter.questionIds);
      return [...store.answers.values()]
        .filter((a) => a.userId === userId && want.has("attemptIds" in filter ? a.attemptId : a.questionId))
        .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt))
        .map(strip);
    },
    async addAnswer(input) {
      const mine = [...store.answers.values()].filter((a) => a.userId === userId);
      const dup = mine.find((a) => a.clientKey === input.clientKey || (a.attemptId === input.attemptId && a.questionId === input.questionId));
      if (dup) return { answer: strip(dup), created: false };
      const attempt = own(store.attempts.get(input.attemptId));
      const question = own(store.questions.get(input.questionId));
      if (!attempt || !question || attempt.subjectId !== input.subjectId || question.subjectId !== input.subjectId) throw new Error("Question not found");
      const a: Owned<QuizAnswer> = { ...clone(input), id: crypto.randomUUID(), userId, answeredAt: now() };
      store.answers.set(a.id, a);
      return { answer: strip(a), created: true };
    },
    async updateAnswer(id, patch) {
      const a = own(store.answers.get(id));
      if (a) Object.assign(a, patch);
    },
    async listWeakTopics(subjectId) {
      return [...store.weakTopics.values()].filter((w) => w.userId === userId && w.subjectId === subjectId).map(strip);
    },
    async getWeakTopic(id) {
      const w = own(store.weakTopics.get(id));
      return w ? strip(w) : null;
    },
    async findWeakTopic(subjectId, key) {
      const w = [...store.weakTopics.values()].find((x) => x.userId === userId && x.subjectId === subjectId && x.topicKey === key);
      return w ? strip(w) : null;
    },
    async saveWeakTopic(subjectId, state, id) {
      if (!own(store.subjects.get(subjectId))) throw new Error("Subject not found");
      const cur = id ? own(store.weakTopics.get(id)) : undefined;
      if (id && !cur) throw new Error("Topic not found");
      const key = topicKey(state.topic);
      if (!cur && [...store.weakTopics.values()].some((x) => x.userId === userId && x.subjectId === subjectId && x.topicKey === key)) throw new Error("duplicate topic");
      const row: Owned<WeakTopic> = { ...clone(state), id: cur?.id ?? crypto.randomUUID(), userId, subjectId, topicKey: key, createdAt: cur?.createdAt ?? now() };
      store.weakTopics.set(row.id, row);
      return strip(row);
    },
    async deleteWeakTopic(id) {
      if (own(store.weakTopics.get(id))) store.weakTopics.delete(id);
    },

    // ---- Step 3 part 2 ----
    async matchChunks() {
      return []; // demo mode has no embeddings: chat uses keyword search
    },
    async searchChunks(subjectId, query, limit, opts = {}) {
      void opts;
      const list = myChunks().filter((c) => c.subjectId === subjectId);
      return rankByKeywords(query, list).slice(0, limit).map((r) => strip(r.item));
    },
    async embeddingCounts(subjectId) {
      return { total: myChunks().filter((c) => c.subjectId === subjectId).length, embedded: 0 };
    },
    async listChat(subjectId, { limit, before }) {
      return [...store.chat.values()]
        .filter((m) => m.userId === userId && m.subjectId === subjectId && (!before || m.createdAt < before))
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
        .slice(0, limit)
        .map(strip);
    },
    async getChatMessage(id) {
      const m = own(store.chat.get(id));
      return m ? strip(m) : null;
    },
    async findChatExchange(clientKey) {
      const q = [...store.chat.values()].find((m) => m.userId === userId && m.clientKey === clientKey);
      if (!q) return null;
      const a = [...store.chat.values()].find((m) => m.userId === userId && m.replyTo === q.id);
      return { question: strip(q), answer: a ? strip(a) : null };
    },
    async addChatExchange(subjectId, { clientKey, question, answer, after }) {
      if (!own(store.subjects.get(subjectId))) throw new Error("Subject not found");
      if ([...store.chat.values()].filter((m) => m.userId === userId && m.subjectId === subjectId).length + 2 > CHAT_CAP) throw new Error("chat message limit reached");
      if ([...store.chat.values()].some((m) => m.userId === userId && m.clientKey === clientKey)) throw new Error("duplicate client key");
      const at = Math.max(Date.now(), after ? Date.parse(after) + 1 : 0);
      const q: Owned<ChatRow> = {
        id: crypto.randomUUID(), userId, subjectId, role: "user", kind: "question", content: question, citations: [], reveal: null, feedback: null,
        clientKey, replyTo: null, createdAt: new Date(at).toISOString(),
      };
      const a: Owned<ChatRow> = {
        id: crypto.randomUUID(), userId, subjectId, role: "assistant", kind: answer.kind, content: answer.content, citations: clone(answer.citations),
        reveal: answer.reveal, feedback: null, clientKey: null, replyTo: q.id, createdAt: new Date(at + 1).toISOString(),
      };
      store.chat.set(q.id, q);
      store.chat.set(a.id, a);
      return { question: strip(q), answer: strip(a) };
    },
    async setChatFeedback(id, feedback) {
      const m = own(store.chat.get(id));
      if (m && m.role === "assistant") m.feedback = feedback;
    },
    async clearChat(subjectId) {
      for (const [k, m] of store.chat) if (m.userId === userId && m.subjectId === subjectId) store.chat.delete(k);
    },
    async countChat(subjectId) {
      return [...store.chat.values()].filter((m) => m.userId === userId && m.subjectId === subjectId).length;
    },
    async deleteOldestChat(subjectId, questions) {
      const oldest = [...store.chat.values()]
        .filter((m) => m.userId === userId && m.subjectId === subjectId && m.role === "user")
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .slice(0, questions)
        .map((m) => m.id);
      const gone = new Set(oldest);
      for (const [k, m] of store.chat) if (gone.has(k) || (m.replyTo && gone.has(m.replyTo))) store.chat.delete(k);
    },

    async addStudySession(input) {
      const mine = [...store.studySessions.values()].filter((x) => x.userId === userId);
      const earlier = mine.find((x) => x.clientKey === input.clientKey);
      if (earlier) return { session: strip(earlier), created: false };
      if (mine.length >= STUDY_SESSION_CAP) throw new Error("study session limit reached");
      if (input.subjectId && !own(store.subjects.get(input.subjectId))) throw new Error("subject not found");
      const row: Owned<StudySession> = { ...input, id: crypto.randomUUID(), userId, createdAt: now() };
      store.studySessions.set(row.id, row);
      return { session: strip(row), created: true };
    },
    async listStudySessions({ endedSince }) {
      return [...store.studySessions.values()]
        .filter((x) => x.userId === userId && x.endedAt >= endedSince)
        .sort((a, b) => a.endedAt.localeCompare(b.endedAt))
        .map(strip);
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
        quizzes: [...store.quizzes.values()].filter((q) => q.userId === userId).map(strip),
        questions: [...store.questions.values()].filter((q) => q.userId === userId).map(strip),
        quizAttempts: [...store.attempts.values()].filter((a) => a.userId === userId).map(strip),
        answers: [...store.answers.values()].filter((a) => a.userId === userId).map(strip),
        weakTopics: [...store.weakTopics.values()].filter((w) => w.userId === userId).map(strip),
        chatMessages: [...store.chat.values()].filter((m) => m.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(strip),
        studySessions: [...store.studySessions.values()].filter((x) => x.userId === userId).sort((a, b) => a.startedAt.localeCompare(b.startedAt)).map(strip),
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
  for (const [k, q] of store.quizzes) if (q.userId === userId) dropQuiz(k);
  for (const [k, w] of store.weakTopics) if (w.userId === userId) store.weakTopics.delete(k);
  for (const [k, m] of store.chat) if (m.userId === userId) store.chat.delete(k);
  for (const [k, x] of store.studySessions) if (x.userId === userId) store.studySessions.delete(k);
  for (const k of store.aiUsage.keys()) if (k.startsWith(`${userId}|`)) store.aiUsage.delete(k);
  for (const k of store.aiCache.keys()) if (k.startsWith(`${userId}|`)) store.aiCache.delete(k);
  store.profiles.delete(userId);
}
