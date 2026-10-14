import type { SubjectColour } from "@/lib/subjects";
import type { MindmapGraph } from "@/lib/ai/types";
import type { Chunk } from "@/lib/extract/chunk";
import type { AiKind } from "@/lib/limits/ai";
import type { Rating, SrsState, SrsStateNum } from "@/lib/srs/scheduler";
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

export type Profile = { soundOn: boolean; volume: number; theme: "system" | "light" | "dark"; timezone: string };

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

export type ExportBundle = {
  exportedAt: string;
  profile: Profile;
  subjects: Subject[];
  notes: Note[];
  sources: (Source & { extractedText: string })[];
  flashcards: Flashcard[];
  cardReviews: CardReview[];
  mindmaps: Mindmap[];
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
  /** Atomically takes one go if under `limit`; false when the limit is used. */
  reserveAi(day: string, kind: AiKind, limit: number): Promise<boolean>;
  /** Gives the go back when the generation failed; records tokens. */
  settleAi(day: string, kind: AiKind, ok: boolean, inputTokens: number, outputTokens: number): Promise<void>;
  /** App-wide budget shared by every student (not per student). */
  reserveAppBudget(day: string, model: string, maxRequests: number, maxTokens: number): Promise<boolean>;
  addAppTokens(day: string, model: string, tokens: number): Promise<void>;
  appBudgetLeft(day: string, model: string, maxRequests: number, maxTokens: number): Promise<boolean>;
  getAiCache(kind: AiKind, inputHash: string): Promise<{ model: string; output: unknown } | null>;
  putAiCache(kind: AiKind, inputHash: string, model: string, output: unknown): Promise<void>;

  getProfile(): Promise<Profile>;
  updateProfile(patch: SettingsUpdate): Promise<void>;

  exportAll(): Promise<ExportBundle>;
}
