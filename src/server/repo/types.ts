import type { SubjectColour } from "@/lib/subjects";
import type { Chunk } from "@/lib/extract/chunk";
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

export type NoteSummary = { id: string; subjectId: string; title: string; preview: string; updatedAt: string };
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

export type Profile = { soundOn: boolean; volume: number; theme: "system" | "light" | "dark" };

export type ExportBundle = {
  exportedAt: string;
  profile: Profile;
  subjects: Subject[];
  notes: Note[];
  sources: (Source & { extractedText: string })[];
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

  getProfile(): Promise<Profile>;
  updateProfile(patch: SettingsUpdate): Promise<void>;

  exportAll(): Promise<ExportBundle>;
}
