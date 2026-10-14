import { z } from "zod";
import { safeTimeZone } from "./srs/due";
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
  timezone: z.string().max(64).refine((tz) => safeTimeZone(tz) === tz, "Unknown time zone.").optional(),
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

// ---- Step 2 -------------------------------------------------------------------
export const CARD_FRONT_MAX = 500;
export const CARD_BACK_MAX = 1500;
export const MAX_CARD_PAGES = 20;

export const cardText = z.object({
  front: z.string().trim().min(1, "Add some text to the front.").max(CARD_FRONT_MAX, `Keep the front under ${CARD_FRONT_MAX} characters.`),
  back: z.string().trim().min(1, "Add some text to the back.").max(CARD_BACK_MAX, `Keep the back under ${CARD_BACK_MAX} characters.`),
});
export const newCardInput = cardText.extend({ subjectId: id });
export const editCardInput = cardText.extend({ id });

export const makeFlashcardsInput = z.object({
  subjectId: id,
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("note"), id }),
    z.object({
      type: z.literal("file"),
      id,
      fromPage: z.int().min(1).max(10_000),
      toPage: z.int().min(1).max(10_000),
    }).refine((s) => s.toPage >= s.fromPage, "The last page comes before the first.")
      .refine((s) => s.toPage - s.fromPage < MAX_CARD_PAGES, `Up to ${MAX_CARD_PAGES} pages at a time.`),
  ]),
  count: z.union([z.literal(10), z.literal(15), z.literal(20)]),
});
export type MakeFlashcardsInput = z.infer<typeof makeFlashcardsInput>;

export const reviewInput = z.object({
  flashcardId: id,
  rating: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  clientKey: z.uuid(),
});

export const makeMindmapInput = z.object({
  subjectId: id,
  selection: z.object({ all: z.boolean(), noteIds: z.array(id).max(500), sourceIds: z.array(id).max(500) }),
  force: z.boolean(),
});
