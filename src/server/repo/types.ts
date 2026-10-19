import type { SubjectColour } from "@/lib/subjects";
import type { MindmapGraph } from "@/lib/ai/types";
import type { Chunk } from "@/lib/extract/chunk";
import type { AiKind } from "@/lib/limits/ai";
import type { AttemptSlot, QuestionType, QuizKind } from "@/lib/quiz/order";
import type { WeakPrev, WeakState } from "@/lib/quiz/weak";
import type { Rating, SrsState, SrsStateNum } from "@/lib/srs/scheduler";
import type { Phase } from "@/lib/timer/machine";
import type { FeedSlot, FeedSubject } from "@/lib/timetable/feed";
import type { SlotCore, SlotLike } from "@/lib/timetable/slots";
import type { SettingsUpdate } from "@/lib/validation";

export type Subject = {
  id: string;
  name: string;
  colour: SubjectColour;
  emoji: string;
  createdAt: string;
  noteCount: number;
  sourceCount: number;
};

export type NoteSummary = { id: string; subjectId: string; title: string; preview: string; updatedAt: string; /** Length of title + text. */ chars: number };
export type Note = NoteSummary & { contentJson: Record<string, unknown>; contentText: string };

export type ExtractStatus = "pending" | "reading" | "ready" | "no_text" | "failed";
export type Source = {
  id: string;
  subjectId: string;
  fileName: string;
  kind: "pdf" | "pptx";
  sizeBytes: number;
  storagePath: string;
  pageCount: number | null;
  extractStatus: ExtractStatus;
  extractError: string | null;
  createdAt: string;
};

export type Profile = {
  soundOn: boolean;
  volume: number;
  theme: "system" | "light" | "dark";
  timezone: string;
  // Step 4: study timer defaults (settings.md "Study timer").
  timerFocusMin: number;
  timerShortMin: number;
  timerLongMin: number;
  timerLongEvery: number;
  timerAutoStart: boolean;
  focusQuiet: boolean;
  // Step 4 part 2: timetable (settings.md "Timetable and calendar").
  weekStart: "mon" | "sun";
};

/** A stored passage of a note or lecture file. */
export type ChunkRow = {
  id: string;
  subjectId: string;
  noteId: string | null;
  sourceId: string | null;
  ordinal: number;
  page: number | null;
  text: string;
  contentHash: string;
};

export type Flashcard = {
  id: string;
  subjectId: string;
  front: string;
  back: string;
  sourceQuote: string | null;
  origin: "ai" | "manual";
  edited: boolean;
  createdAt: string;
  /** Links to where the card came from; cleared (not the card) when that is deleted. */
  chunkId: string | null;
  noteId: string | null;
  sourceId: string | null;
  page: number | null;
  inputHash: string | null;
  deletedAt: string | null;
  srs: SrsState;
};
export type NewFlashcard = {
  subjectId: string;
  front: string;
  back: string;
  origin: "ai" | "manual";
  sourceQuote?: string | null;
  chunkId?: string | null;
  noteId?: string | null;
  sourceId?: string | null;
  page?: number | null;
  inputHash?: string | null;
};

export type CardReview = {
  id: string;
  flashcardId: string;
  subjectId: string;
  rating: Rating;
  prevState: SrsStateNum;
  reviewedAt: string;
  /** The review screen's key for this grade (makes retried saves and undos idempotent). */
  clientKey: string | null;
  /** Card schedule after this review. */
  srs: SrsState;
};

export type MindmapSources = { all: boolean; noteIds: string[]; sourceIds: string[] };
export type Mindmap = {
  id: string;
  subjectId: string;
  graph: MindmapGraph;
  inputHash: string;
  sources: MindmapSources;
  /** When this version was generated (regenerating resets it). */
  createdAt: string;
  updatedAt: string;
};

// ---- Step 3: quizzes and weak topics ----------------------------------------------

export type Quiz = {
  id: string;
  subjectId: string;
  /** Built by the server ("Lecture 3.pdf · pages 1–20 · Mixed"), never the AI. */
  title: string;
  kind: QuizKind;
  focus: "all" | "weak";
  requested: number;
  /** Notes and files it was made from (empty = everything in the subject, or weak topics). */
  sourceIds: string[];
  pageFrom: number | null;
  pageTo: number | null;
  inputHash: string;
  createdAt: string;
  deletedAt: string | null;
};
export type NewQuiz = Omit<Quiz, "id" | "createdAt" | "deletedAt">;

export type Question = {
  id: string;
  quizId: string;
  subjectId: string;
  ordinal: number;
  type: QuestionType;
  prompt: string;
  /** Multiple choice: 4 options in the question's own (server-shuffled) order. */
  options: string[] | null;
  correctIndex: number | null;
  answer: string;
  accepted: string[];
  explanation: string;
  topic: string;
  sourceQuote: string | null;
  chunkId: string | null;
  noteId: string | null;
  sourceId: string | null;
  page: number | null;
  edited: boolean;
  removedAt: string | null;
};
export type NewQuestion = Omit<Question, "id" | "quizId" | "subjectId" | "edited" | "removedAt">;
export type QuestionPatch = Partial<Pick<Question, "prompt" | "options" | "correctIndex" | "answer" | "accepted" | "explanation" | "edited" | "removedAt">>;

export type QuizAttempt = {
  id: string;
  quizId: string;
  subjectId: string;
  order: AttemptSlot[];
  startedAt: string;
  finishedAt: string | null;
  score: number | null;
  total: number | null;
};

export type QuizAnswer = {
  id: string;
  attemptId: string;
  questionId: string;
  subjectId: string;
  clientKey: string;
  given: string;
  /** Multiple choice: the option picked, in the question's own order. */
  choice: number | null;
  dontKnow: boolean;
  correct: boolean;
  typo: boolean;
  overridden: boolean;
  /** The weak topic before this miss ("I was right" undoes exactly that). */
  weakPrev: WeakPrev | null;
  answeredAt: string;
};
export type NewQuizAnswer = Omit<QuizAnswer, "id" | "answeredAt">;

export type WeakTopic = WeakState & { id: string; subjectId: string; topicKey: string; createdAt: string };

// ---- Step 3 part 2: ask your notes ----------------------------------------------------

export type ChatFeedback = "wrong" | "not_in_notes" | "too_long";
/** Where an answer's [n] came from (for a not-covered reply: the "Closest I found" passages). */
export type ChatCitation = {
  n: number;
  chunkId: string;
  noteId: string | null;
  sourceId: string | null;
  page: number | null;
  /** "Lecture 3.pdf, page 12" or "Cell structure (note)", as it was when answered. */
  label: string;
  /** A sentence of the passage (verified to be in it), still readable after the source is deleted. */
  quote: string;
};
export type ChatRow = {
  id: string;
  subjectId: string;
  role: "user" | "assistant";
  kind: "question" | "answer" | "not_covered";
  /** A question as typed, or an answer in the safe Markdown subset (src/lib/chat/render.ts). */
  content: string;
  citations: ChatCitation[];
  /** "Quiz me": the answer behind "Show answer". */
  reveal: string | null;
  feedback: ChatFeedback | null;
  clientKey: string | null;
  /** An answer's question. */
  replyTo: string | null;
  createdAt: string;
};
export type NewChatAnswer = { kind: "answer" | "not_covered"; content: string; citations: ChatCitation[]; reveal: string | null };

// ---- Step 4: study timer ---------------------------------------------------------------

/** One timer phase that ended (completed, stopped, or ended while away). */
export type StudySession = {
  id: string;
  /** null: "No subject", or its subject was deleted (the time still counts). */
  subjectId: string | null;
  kind: Phase;
  plannedSec: number;
  /** Running time, pauses excluded. */
  focusedSec: number;
  completed: boolean;
  startedAt: string;
  endedAt: string;
  /** The timer's session id: a retried save logs once. */
  clientKey: string;
  createdAt: string;
};
export type NewStudySession = Omit<StudySession, "id" | "createdAt">;

// ---- Step 4 part 2: timetable and calendar link -----------------------------------------

/** A timetable slot (timetable.md). Times are wall-clock in the slot's own `tz`. */
export type TimetableSlot = SlotLike & {
  source: "manual" | "import";
  /** Imported classes: stable key from the file, and the import they came from. */
  importUid: string | null;
  importBatch: string | null;
  createdAt: string;
  updatedAt: string;
};
export type NewTimetableSlot = SlotCore & Pick<TimetableSlot, "source" | "importUid" | "importBatch"> & { importPrev?: ImportPrev };
/**
 * What an import did to a slot (so its Undo can take it back): added it, removed it, or changed it
 * from `before`. `at` is when. Server-only bookkeeping; the next import clears it, so only the
 * latest import can be undone, and only for a few minutes (S4-3).
 */
export type ImportPrev = { batch: string; at: string } & ({ added: true } | { removed: true } | { before: SlotCore & { importBatch: string | null } });
export type SlotPatch = Partial<SlotCore> & { importBatch?: string | null; importPrev?: ImportPrev | null };

/** The student's private calendar link (server-only; never in the export). */
export type CalendarLink = { token: string; createdAt: string; lastFetchedAt: string | null };
/** What the public feed route serves for a token. */
export type CalendarFeedData = { slots: FeedSlot[]; subjects: FeedSubject[] };

export type ExportBundle = {
  exportedAt: string;
  profile: Profile;
  subjects: Subject[];
  notes: Note[];
  sources: (Source & { extractedText: string })[];
  flashcards: Flashcard[];
  cardReviews: CardReview[];
  mindmaps: Mindmap[];
  quizzes: Quiz[];
  questions: Question[];
  quizAttempts: QuizAttempt[];
  answers: QuizAnswer[];
  weakTopics: WeakTopic[];
  chatMessages: ChatRow[];
  studySessions: StudySession[];
  /** Step 4 part 2. The calendar link token is never exported. */
  timetableSlots: TimetableSlot[];
};

/**
 * Data access for one signed-in student. Every method is scoped to that student;
 * the Supabase implementation additionally relies on RLS, so a bug here still
 * can't expose another student's rows.
 */
export interface Repo {
  readonly userId: string;
  listSubjects(): Promise<Subject[]>;
  getSubject(id: string): Promise<Subject | null>;
  createSubject(input: { name: string; colour: SubjectColour; emoji: string }): Promise<Subject>;
  updateSubject(id: string, input: { name: string; colour: SubjectColour; emoji: string }): Promise<void>;
  deleteSubject(id: string): Promise<void>;

  listNotes(subjectId: string): Promise<NoteSummary[]>;
  getNote(id: string): Promise<Note | null>;
  createNote(subjectId: string): Promise<{ id: string }>;
  updateNote(id: string, input: { title: string; contentJson: Record<string, unknown>; contentText: string }): Promise<{ updatedAt: string }>;
  deleteNote(id: string): Promise<void>;
  /** Brings a note's passages in line with its text, keeping the ids of unchanged passages. */
  replaceNoteChunks(noteId: string, subjectId: string, chunks: Chunk[]): Promise<void>;

  listSources(subjectId: string): Promise<Source[]>;
  getSource(id: string): Promise<Source | null>;
  createSource(input: { id: string; subjectId: string; fileName: string; kind: "pdf" | "pptx"; sizeBytes: number; storagePath: string }): Promise<Source>;
  updateSource(id: string, patch: Partial<Pick<Source, "extractStatus" | "extractError" | "pageCount" | "sizeBytes">>): Promise<void>;
  deleteSource(id: string): Promise<{ storagePath: string } | null>;
  replaceSourceChunks(sourceId: string, subjectId: string, chunks: Chunk[]): Promise<void>;
  /** For upload limits: uploads started since `sinceIso` (from the append-only log), and bytes stored now. */
  uploadStats(sinceIso: string): Promise<{ countSince: number; totalBytes: number }>;
  recordUpload(bytes: number): Promise<void>;

  /** Passages, in reading order. */
  listChunks(filter: { noteId: string } | { sourceId: string } | { subjectId: string }): Promise<ChunkRow[]>;
  getChunks(ids: string[]): Promise<ChunkRow[]>;
  /** Characters per (file, page) of a subject's files; page null = passages without a page. Counts only, never text. */
  listPageChars(subjectId: string): Promise<{ sourceId: string; page: number | null; chars: number }[]>;

  /** Cards not deleted, newest first. Without a subject: every subject's cards. */
  listFlashcards(filter?: { subjectId?: string }): Promise<Flashcard[]>;
  /** Includes soft-deleted cards (for Undo). */
  getFlashcard(id: string): Promise<Flashcard | null>;
  /** Cards still in the deck that a generation with this cache key made. */
  findFlashcardsByHash(inputHash: string): Promise<Flashcard[]>;
  createFlashcards(cards: NewFlashcard[]): Promise<Flashcard[]>;
  /** Edits text and marks the card edited; never touches the schedule. */
  updateFlashcardText(id: string, input: { front: string; back: string }): Promise<void>;
  setFlashcardDeleted(id: string, deleted: boolean): Promise<void>;
  setFlashcardSrs(id: string, srs: SrsState): Promise<void>;

  /** Saves a review. With a clientKey that was already saved, returns the earlier row instead. */
  addCardReview(input: Omit<CardReview, "id"> & { clientKey: string | null }): Promise<CardReview>;
  /** Newest first. */
  latestReviews(flashcardId: string, limit: number): Promise<CardReview[]>;
  deleteCardReview(id: string): Promise<void>;
  /** New cards met (first review) since this instant: counts towards the daily new-card allowance. */
  countIntroducedSince(sinceIso: string): Promise<number>;
  /** Any grades since this instant (for "All caught up for today"). */
  countReviewsSince(sinceIso: string): Promise<number>;

  getMindmap(subjectId: string): Promise<Mindmap | null>;
  /** Creates or replaces the subject's map (a regenerate resets createdAt). */
  saveMindmap(subjectId: string, input: { graph: MindmapGraph; inputHash: string; sources: MindmapSources }): Promise<Mindmap>;
  updateMindmapGraph(subjectId: string, graph: MindmapGraph): Promise<void>;

  /** Successful generations of this kind on this (local) day. */
  aiUsageCount(day: string, kind: AiKind): Promise<number>;
  /**
   * Atomically takes one go if under `limit` and under `maxAttempts` tries today (failed tries
   * give the go back but still count as tries); false when either is used up.
   */
  reserveAi(day: string, kind: AiKind, limit: number, maxAttempts: number): Promise<boolean>;
  /** Gives the go back when the generation failed; records tokens. */
  settleAi(day: string, kind: AiKind, ok: boolean, inputTokens: number, outputTokens: number): Promise<void>;
  /** App-wide budget shared by every student (not per student). */
  reserveAppBudget(day: string, model: string, maxRequests: number, maxTokens: number): Promise<boolean>;
  addAppTokens(day: string, model: string, tokens: number): Promise<void>;
  appBudgetLeft(day: string, model: string, maxRequests: number, maxTokens: number): Promise<boolean>;
  getAiCache(kind: AiKind, inputHash: string): Promise<{ model: string; output: unknown } | null>;
  putAiCache(kind: AiKind, inputHash: string, model: string, output: unknown): Promise<void>;

  // ---- Step 3 ----
  /** Quizzes not deleted, newest first. */
  listQuizzes(subjectId: string): Promise<Quiz[]>;
  /** Includes soft-deleted quizzes (for Undo). */
  getQuiz(id: string): Promise<Quiz | null>;
  /** A quiz still on the shelf that a generation with this cache key made. */
  findQuizByHash(subjectId: string, inputHash: string): Promise<Quiz | null>;
  /** Every quiz in the subject, deleted ones included (for the cap). */
  countQuizzes(subjectId: string): Promise<number>;
  createQuiz(quiz: NewQuiz, questions: NewQuestion[]): Promise<{ quiz: Quiz; questions: Question[] }>;
  setQuizDeleted(id: string, deleted: boolean): Promise<void>;
  /** Removes quizzes deleted before this instant (their Undo has long expired). */
  purgeDeletedQuizzes(subjectId: string, beforeIso: string): Promise<void>;

  /** Removed questions included, in quiz order. */
  listQuestions(filter: { quizId: string } | { quizIds: string[] } | { subjectId: string; topicKey: string }): Promise<Question[]>;
  getQuestion(id: string): Promise<Question | null>;
  updateQuestion(id: string, patch: QuestionPatch): Promise<void>;

  /** Newest first. */
  listAttempts(filter: { quizId: string } | { subjectId: string }): Promise<QuizAttempt[]>;
  getAttempt(id: string): Promise<QuizAttempt | null>;
  createAttempt(input: { quizId: string; subjectId: string; order: QuizAttempt["order"] }): Promise<QuizAttempt>;
  deleteAttempts(ids: string[]): Promise<void>;
  updateAttempt(id: string, patch: { finishedAt?: string | null; score?: number | null; total?: number | null }): Promise<void>;

  listAnswers(filter: { attemptIds: string[] } | { questionIds: string[] }): Promise<QuizAnswer[]>;
  /**
   * Saves an answer. When this attempt already has an answer to the question, or the client key
   * was used, returns the earlier row instead (`created` false).
   */
  addAnswer(input: NewQuizAnswer): Promise<{ answer: QuizAnswer; created: boolean }>;
  updateAnswer(id: string, patch: { correct?: boolean; overridden?: boolean }): Promise<void>;

  listWeakTopics(subjectId: string): Promise<WeakTopic[]>;
  getWeakTopic(id: string): Promise<WeakTopic | null>;
  findWeakTopic(subjectId: string, topicKey: string): Promise<WeakTopic | null>;
  /** Inserts (no id) or updates the topic's row. */
  saveWeakTopic(subjectId: string, state: WeakState, id?: string): Promise<WeakTopic>;
  deleteWeakTopic(id: string): Promise<void>;

  // ---- Step 3 part 2: ask your notes ----
  /** A subject's embedded passages nearest to an embedding (cosine similarity, best first). Empty without embeddings. */
  matchChunks(subjectId: string, embedding: number[], limit: number): Promise<(ChunkRow & { similarity: number })[]>;
  /** Candidate passages sharing any of the query's words (full-text), best first; the caller scores them. */
  searchChunks(subjectId: string, query: string, limit: number, opts?: { unembeddedOnly?: boolean }): Promise<ChunkRow[]>;
  /** How many of a subject's passages there are, and how many have embeddings. */
  embeddingCounts(subjectId: string): Promise<{ total: number; embedded: number }>;

  /** Newest first; `before` pages back through older messages. */
  listChat(subjectId: string, opts: { limit: number; before?: string }): Promise<ChatRow[]>;
  getChatMessage(id: string): Promise<ChatRow | null>;
  /** The question sent with this client key and its answer (a retried send gets these back). */
  findChatExchange(clientKey: string): Promise<{ question: ChatRow; answer: ChatRow | null } | null>;
  /**
   * Saves a question and its answer together (the answer 1 ms after the question), both after
   * `after` (the subject's newest message) so the chat's order never ties.
   */
  addChatExchange(subjectId: string, input: { clientKey: string; question: string; answer: NewChatAnswer; after?: string }): Promise<{ question: ChatRow; answer: ChatRow }>;
  setChatFeedback(id: string, feedback: ChatFeedback): Promise<void>;
  clearChat(subjectId: string): Promise<void>;
  countChat(subjectId: string): Promise<number>;
  /** Removes the oldest questions (and their answers) of a subject. */
  deleteOldestChat(subjectId: string, questions: number): Promise<void>;

  // ---- Step 4: study timer ----
  /**
   * Logs a timer phase. A client key that was already saved returns the earlier row instead
   * (`created` false). The subject must be the student's (the caller checks; the database's
   * composite key refuses anything else).
   */
  addStudySession(input: NewStudySession): Promise<{ session: StudySession; created: boolean }>;
  /** Phases that ended at or after this instant, oldest first. */
  listStudySessions(filter: { endedSince: string }): Promise<StudySession[]>;

  // ---- Step 4 part 2: timetable and calendar link ----
  /** Live slots (not deleted), oldest first. */
  listSlots(): Promise<TimetableSlot[]>;
  /** A live slot, or with `deleted` a soft-deleted one too (for Undo). */
  getSlot(id: string, opts?: { deleted?: boolean }): Promise<TimetableSlot | null>;
  /** Saves new slots; throws "timetable slot limit reached" past 300 live slots. */
  createSlots(rows: NewTimetableSlot[]): Promise<TimetableSlot[]>;
  updateSlot(id: string, patch: SlotPatch): Promise<void>;
  /** Soft delete (for Undo) or bring back; restoring past the cap throws like createSlots. */
  setSlotDeleted(id: string, deleted: boolean): Promise<void>;
  /** Removes slots deleted before this instant (their Undo has long expired). */
  purgeDeletedSlots(beforeIso: string): Promise<void>;
  /**
   * Applies an import as one batch: inserts new classes, updates matching ones (remembering what
   * they were) and soft-deletes removed ones. Clears earlier imports' Undo records first.
   */
  applyImport(batch: string, ops: { insert: NewTimetableSlot[]; update: { id: string; next: SlotCore & { importUid: string } }[]; remove: string[] }): Promise<void>;
  /** Undoes an import batch: deletes its new classes and puts updated and removed ones back. */
  /** Takes back what import `batch` did, if it is the latest import and was made at or after `sinceIso`. */
  undoImport(batch: string, sinceIso: string): Promise<number>;

  getCalendarLink(): Promise<CalendarLink | null>;
  /** Creates or replaces the link (a reset): the old token stops working at once. */
  setCalendarLink(token: string): Promise<CalendarLink>;
  deleteCalendarLink(): Promise<void>;

  getProfile(): Promise<Profile>;
  updateProfile(patch: SettingsUpdate): Promise<void>;

  exportAll(): Promise<ExportBundle>;
}
