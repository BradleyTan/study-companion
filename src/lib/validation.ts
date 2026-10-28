import { z } from "zod";
import { safeTimeZone } from "./srs/due";
import { MAX_PLANNED_SEC, MIN_LOG_SEC, RANGES } from "./timer/machine";
import { COLOUR_NAMES, SUBJECT_EMOJIS } from "./subjects";
import { dayOf } from "./timetable/dates";
import { IMPORT_MAX_CLASSES } from "./timetable/limits";
import { LOCATION_MAX, MAX_SKIPS, SLOT_ERRORS, SLOT_KINDS, slotError, TITLE_MAX } from "./timetable/slots";

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
  // Step 4: study timer defaults (settings.md, timer.md "Durations").
  timerFocusMin: z.int().min(RANGES.focusMin.min).max(RANGES.focusMin.max).multipleOf(RANGES.focusMin.step).optional(),
  timerShortMin: z.int().min(RANGES.shortMin.min).max(RANGES.shortMin.max).optional(),
  timerLongMin: z.int().min(RANGES.longMin.min).max(RANGES.longMin.max).multipleOf(RANGES.longMin.step).optional(),
  timerLongEvery: z.int().min(RANGES.longEvery.min).max(RANGES.longEvery.max).optional(),
  timerAutoStart: z.boolean().optional(),
  focusQuiet: z.boolean().optional(),
  // Step 4 part 2: timetable (settings.md "Week starts on").
  weekStart: z.enum(["mon", "sun"]).optional(),
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

/** Most pages in one set of study notes (make-notes.md, same as flashcards). */
export const MAX_NOTES_PAGES = 50;
export const WEB_URL_MAX = 2000;

export const makeStudyNotesInput = z.object({
  subjectId: id,
  source: z.discriminatedUnion("type", [
    z.object({ type: z.literal("note"), id }),
    fileSource(MAX_NOTES_PAGES),
    z.object({ type: z.literal("web"), url: z.string().trim().min(1, "Paste a link to a web page.").max(WEB_URL_MAX, "That link is too long.") }),
  ]),
});
export type MakeStudyNotesInput = z.infer<typeof makeStudyNotesInput>;

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
  // Up to the database's 10 (3 from the model plus answers counted as right with "I was right").
  accepted: z.array(z.string().trim().min(1).max(60, "Keep each answer under 60 characters.")).max(10, "Keep it to 10 other answers.").optional(),
});

// ---- Step 3 part 2: ask your notes (chat.md) ---------------------------------------------
export const CHAT_QUESTION_MAX = 500;
export const askInput = z.object({
  subjectId: id,
  question: z.string().trim().min(1, "Type a question first.").max(CHAT_QUESTION_MAX, `Keep your question under ${CHAT_QUESTION_MAX} characters.`),
  /** The composer's key for this question: a retried send answers once. */
  clientKey: z.uuid(),
});
export const olderChatInput = z.object({ subjectId: id, before: z.iso.datetime({ offset: true }) });
export const chatFeedbackInput = z.object({ messageId: id, feedback: z.enum(["wrong", "not_in_notes", "too_long"]) });

// ---- Step 4: study timer --------------------------------------------------------------
/** A queued round older than this is dropped instead of saved (timer.md: one device's timer). */
export const STUDY_LOG_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const studySessionInput = z.object({
  clientKey: z.uuid(),
  subjectId: z.uuid().nullable(),
  kind: z.enum(["focus", "short_break", "long_break"]),
  plannedSec: z.int().min(60).max(MAX_PLANNED_SEC),
  focusedSec: z.int().min(MIN_LOG_SEC, "Rounds under a minute aren't saved.").max(MAX_PLANNED_SEC),
  completed: z.boolean(),
  startedAt: z.iso.datetime({ offset: true }),
  endedAt: z.iso.datetime({ offset: true }),
})
  .refine((s) => Date.parse(s.endedAt) > Date.parse(s.startedAt), "A round ends after it starts.")
  .refine((s) => Date.parse(s.endedAt) - Date.parse(s.startedAt) <= 2 * DAY_MS, "That round is too long.")
  .refine((s) => s.focusedSec <= (Date.parse(s.endedAt) - Date.parse(s.startedAt)) / 1000 + 5, "More time than the round lasted.")
  .refine((s) => s.focusedSec <= s.plannedSec + 5, "More time than the round was set for.");
export type StudySessionInput = z.infer<typeof studySessionInput>;

// ---- Step 4 part 2: timetable and calendar link (timetable.md) ---------------------------
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.").refine((d) => {
  const n = dayOf(d);
  return Number.isFinite(n) && d >= "2000-01-01" && d <= "2100-12-31";
}, "Pick a real date.");

/** The slot form (and drag, which sends the same thing). */
export const slotInput = z.object({
  kind: z.enum(SLOT_KINDS),
  subjectId: z.uuid().nullable(),
  title: z.string().trim().max(TITLE_MAX, `Keep the title under ${TITLE_MAX} characters.`).transform((v) => v || null),
  location: z.string().trim().max(LOCATION_MAX, `Keep the location under ${LOCATION_MAX} characters.`).transform((v) => v || null),
  date: isoDate,
  startMin: z.int().min(0).max(1439),
  endMin: z.int().min(1).max(1440),
  repeats: z.enum(["weekly", "none"]),
  until: isoDate.nullable(),
}).superRefine((s, ctx) => {
  const bad = slotError({ startMin: s.startMin, endMin: s.endMin, startDate: s.date, repeatUntil: s.until, recurrence: s.repeats });
  if (bad) ctx.addIssue({ code: "custom", message: bad, path: [bad === SLOT_ERRORS.untilBefore ? "until" : "endMin"] });
});
export type SlotInput = z.infer<typeof slotInput>;

export const editSlotInput = z.object({ id, date: isoDate, scope: z.enum(["this", "all"]), slot: slotInput });
export const deleteSlotInput = z.object({ id, date: isoDate, scope: z.enum(["this", "all"]) });
export const undoSlotInput = z.discriminatedUnion("type", [
  z.object({ type: z.literal("restore"), id }),
  z.object({ type: z.literal("unskip"), id, date: isoDate }),
  z.object({ type: z.literal("until"), id, until: isoDate.nullable() }),
]);
export type SlotUndo = z.infer<typeof undoSlotInput>;

/** A class from the import preview, sent back when the student presses "Add N classes". */
const importClass = z.object({
  key: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  subjectId: z.uuid().nullable(),
  title: z.string().trim().min(1).max(TITLE_MAX).nullable(),
  location: z.string().trim().min(1).max(LOCATION_MAX).nullable(),
  startDate: isoDate,
  startMin: z.int().min(0).max(1439),
  endMin: z.int().min(1).max(1440),
  recurrence: z.enum(["weekly", "none"]),
  repeatUntil: isoDate.nullable(),
  skipDates: z.array(isoDate).max(MAX_SKIPS),
}).refine((c) => !slotError({ ...c }), "A class in that file has times we can't use.")
  .refine((c) => c.recurrence === "weekly" || (c.repeatUntil === null && c.skipDates.length === 0), "A class in that file has times we can't use.");
export const addImportInput = z.object({
  classes: z.array(importClass).min(1, "Tick at least one group.").max(IMPORT_MAX_CLASSES),
  replace: z.boolean(),
}).refine((v) => new Set(v.classes.map((c) => c.key)).size === v.classes.length, "That import has the same class twice.");
export const undoImportInput = z.object({ batch: id });
