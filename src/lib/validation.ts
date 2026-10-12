import { z } from "zod";
import { COLOUR_NAMES, SUBJECT_EMOJIS } from "./subjects";

export const subjectInput = z.object({
  name: z.string().trim().min(1, "Give your subject a name.").max(60, "Keep the name under 60 characters."),
  colour: z.enum(COLOUR_NAMES as [string, ...string[]]),
  emoji: z.enum(SUBJECT_EMOJIS as unknown as [string, ...string[]]),
});
export type SubjectInput = z.infer<typeof subjectInput>;

export const id = z.uuid();

// Tiptap JSON: we only check shape and size here; the editor schema renders it.
export const noteUpdate = z.object({
  id,
  title: z.string().max(200),
  contentJson: z.record(z.string(), z.unknown()).refine((v) => JSON.stringify(v).length <= 1_000_000, "Note is too large."),
  contentText: z.string().max(200_000, "Note is too long (200,000 characters max)."),
});

export const settingsUpdate = z.object({
  soundOn: z.boolean().optional(),
  volume: z.number().min(0).max(1).optional(),
  theme: z.enum(["system", "light", "dark"]).optional(),
});
export type SettingsUpdate = z.infer<typeof settingsUpdate>;

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const uploadRequest = z.object({
  subjectId: id,
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES, "That file is over 25 MB."),
});
export const UPLOADS_PER_DAY = 20;
// Supabase free plan has 1 GB of file storage for the whole app; 100 MB each fits a pilot of ~10 students.
export const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
