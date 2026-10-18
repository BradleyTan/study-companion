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
/** Most pages in one flashcard set (flashcards.md: a wider range is a quick sample). */
export const MAX_CARD_PAGES = 50;

export const cardText = z.object({
  front: z.string().trim().min(1, "Add some text to the front.").max(CARD_FRONT_MAX, `Keep the front under ${CARD_FRONT_MAX} characters.`),
  back: z.string().trim().min(1, "Add some text to the back.").max(CARD_BACK_MAX, `Keep the back under ${CARD_BACK_MAX} characters.`),
});
export const newCardInput = cardText.extend({ subjectId: id });
export const editCardInput = cardText.extend({ id });

/** A file, with a page range for long files; a file that fits one set is sent without one (whole file). */
const fileSource = (maxPages: number) => z.object({
  type: z.literal("file"),
  id,
  fromPage: z.int().min(1).max(10_000).optional(),
  toPage: z.int().min(1).max(10_000).optional(),
}).refine((s) => (s.fromPage === undefined) === (s.toPage === undefined), "Pick a first and a last page.")
  .refine((s) => s.fromPage === undefined || s.toPage! >= s.fromPage, "The last page comes before the first.")
  .refine((s) => s.fromPage === undefined || s.toPage! - s.fromPage < maxPages, `Up to ${maxPages} pages at a time.`);

export const makeFlashcardsInput = z.object({
  subjectId: id,
  source: z.discriminatedUnion("type", [z.object({ type: z.literal("note"), id }), fileSource(MAX_CARD_PAGES)]),
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

// ---- Step 3 -------------------------------------------------------------------
/** Most pages in one quiz (quiz-builder.md, same as flashcards). */
export const MAX_QUIZ_PAGES = 50;
const topicName = z.string().trim().min(1).max(40);

export const makeQuizInput = z.object({
  subjectId: id,
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("all") }),
    z.object({ type: z.literal("note"), id }),
    fileSource(MAX_QUIZ_PAGES),
    // Practise weak topics: the open topics ticked (by name, matched case-insensitively).
    z.object({ type: z.literal("weak"), topics: z.array(topicName).min(1, "Tick at least one topic.").max(100) }),
  ]),
  kind: z.enum(["mcq", "fill", "mixed"]),
  count: z.union([z.literal(5), z.literal(10), z.literal(15)]),
});
export type MakeQuizInput = z.infer<typeof makeQuizInput>;

export const startAttemptInput = z.object({ quizId: id, fresh: z.boolean() });

export const checkAnswerInput = z.object({
  attemptId: id,
  questionId: id,
  clientKey: z.uuid(),
  /** Multiple choice: the option's position as shown in this attempt (0–3). */
  choice: z.int().min(0).max(3).optional(),
  /** Fill in the blank: what the student typed. */
  text: z.string().max(200, "Keep your answer under 200 characters.").optional(),
  dontKnow: z.boolean().optional(),
}).refine((a) => a.dontKnow || a.choice !== undefined || (a.text !== undefined && a.text.trim().length > 0), "Pick or type an answer.");

export const attemptQuestionInput = z.object({ attemptId: id, questionId: id });
export const reportQuestionInput = attemptQuestionInput.extend({ reason: z.enum(["wrong_answer", "unclear", "not_in_notes"]) });

export const editQuestionInput = z.object({
  questionId: id,
  prompt: z.string().trim().min(5, "Add the question.").max(300, "Keep the question under 300 characters."),
  explanation: z.string().trim().max(400, "Keep the explanation under 400 characters."),
  /** Multiple choice. */
  options: z.array(z.string().trim().min(1, "Fill in every option.").max(160)).length(4).optional(),
  correctIndex: z.int().min(0).max(3).optional(),
  /** Fill in the blank. */
  answer: z.string().trim().min(1, "Add the answer.").max(60, "Keep the answer under 60 characters.").optional(),
  accepted: z.array(z.string().trim().min(1).max(60)).max(6).optional(),
});
