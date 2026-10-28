"use server";
import { revalidatePath } from "next/cache";
import { inputHash } from "@/lib/ai/cache";
import { MIN_NOTE_POINTS, normaliseNotes } from "@/lib/ai/notes";
import { fitPassages } from "@/lib/ai/prompts";
import { aiMode } from "@/lib/ai/providers";
import { runAiTask } from "@/lib/ai/run";
import { passageSentences } from "@/lib/ai/schemas";
import { notesTask, toPassages } from "@/lib/ai/tasks";
import type { Passage } from "@/lib/ai/types";
import { chunkPages } from "@/lib/extract/chunk";
import { DAILY_ATTEMPTS, DAILY_LIMITS, MIN_SOURCE_CHARS, NOTES_MAX_CHARS, type Quota } from "@/lib/limits/ai";
import { notesDocument } from "@/lib/notes/doc";
import { pagesText } from "@/lib/page-range";
import { id as idSchema, makeStudyNotesInput } from "@/lib/validation";
import { appBudget, quotaFor, studentDay } from "../ai";
import { syncNoteChunks } from "../passages";
import { sourceChunks, sourceOptions, type SourceOptions } from "../source-select";
import { getRepo } from "../session";
import { parseWebUrl, readWebPage, WebPageError, type WebError } from "../web-page";
import { firstIssue, type ActionResult } from "./result";

const MAX_NOTES_PER_SUBJECT = 500;
const MAX_CACHE_BYTES = 200_000;

export type NotesOptions = SourceOptions & { quota: Quota };

/** Notes, files and quota for the Make study notes dialog. */
export async function loadNotesOptions(subjectId: string): Promise<ActionResult<NotesOptions>> {
  if (!idSchema.safeParse(subjectId).success) return { ok: false, error: "Subject not found." };
  const repo = await getRepo();
  if (!(await repo.getSubject(subjectId))) return { ok: false, error: "Subject not found." };
  const [opts, quota] = await Promise.all([sourceOptions(repo, subjectId, NOTES_MAX_CHARS), quotaFor(repo, "notes")]);
  return { ok: true, ...opts, quota };
}

export type NotesResult =
  | { status: "made"; noteId: string; title: string; points: number; terms: number; cached: boolean; sampled: boolean; quota: Quota }
  | { status: "too_short"; sourceType: "note" | "file" | "web"; quota: Quota }
  | { status: "web_error"; reason: WebError; quota: Quota }
  | { status: "limit" | "allowance" | "failed" | "not_configured"; quota: Quota };

/** What a source is called on the note's first line. */
function fromLabel(name: string, series: { range: { from: number; to: number }; pageCount: number } | null, unit: "page" | "slide"): string {
  if (!series || (series.range.from === 1 && series.range.to >= series.pageCount)) return name;
  return `${name}, ${pagesText(series.range, unit)}`;
}

/**
 * Makes study notes from one note, a page range of one file, or a web page the student links
 * (make-notes.md), and saves them as a new note in the subject. Quota: only successful,
 * non-cached generations count; the same text again is free. A web page is read after the go is
 * reserved, so a failed read gives it back but still counts toward the day's tries.
 */
export async function makeStudyNotes(raw: unknown): Promise<ActionResult<{ result: NotesResult }>> {
  const parsed = makeStudyNotesInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { subjectId, source } = parsed.data;
  const repo = await getRepo();
  if (!(await repo.getSubject(subjectId))) return { ok: false, error: "Subject not found." };
  if ((await repo.listNotes(subjectId)).length >= MAX_NOTES_PER_SUBJECT) return { ok: false, error: `A subject can hold up to ${MAX_NOTES_PER_SUBJECT} notes.` };
  const quota = () => quotaFor(repo, "notes");
  const mode = aiMode();

  // Note or file: the passages are already stored, so a cached set costs nothing.
  let passages: Passage[] = [];
  let hash = "";
  let name = "";
  let from = "";
  let sampled = false;
  if (source.type !== "web") {
    const found = await sourceChunks(repo, subjectId, source, NOTES_MAX_CHARS);
    if (!found) return { ok: false, error: "That note or file isn't available any more." };
    if ("error" in found) return { ok: false, error: found.error };
    const total = found.chunks.reduce((n, c) => n + c.text.length, 0);
    if (total < MIN_SOURCE_CHARS) return { ok: true, result: { status: "too_short", sourceType: source.type, quota: await quota() } };
    const picked = fitPassages(found.chunks, NOTES_MAX_CHARS);
    sampled = picked.length < found.chunks.length;
    passages = toPassages(picked);
    hash = inputHash("notes", picked.map((c) => c.contentHash));
    name = found.name;
    from = fromLabel(found.name, found.series, found.unit);
    const cached = await saveCached(hash, passages, name, from, sampled);
    if (cached) return { ok: true, result: { ...cached, quota: await quota() } };
  } else {
    try { parseWebUrl(source.url); } catch (e) {
      return { ok: true, result: { status: "web_error", reason: e instanceof WebPageError ? e.code : "bad_url", quota: await quota() } };
    }
  }

  if (mode === "off") return { ok: true, result: { status: "not_configured", quota: await quota() } };
  const day = await studentDay(repo);
  if (!(await repo.reserveAi(day, "notes", DAILY_LIMITS.notes, DAILY_ATTEMPTS.notes))) return { ok: true, result: { status: "limit", quota: await quota() } };
  let ok = false;
  let settled = false;
  let tokens = { input: 0, output: 0 };
  try {
    if (source.type === "web") {
      let page;
      try { page = await readWebPage(source.url); } catch (e) {
        return { ok: true, result: { status: "web_error", reason: e instanceof WebPageError ? e.code : "unreachable", quota: await quota() } };
      }
      // The page's passages exist only for this request: ids are local, nothing is stored but the notes.
      const chunks = chunkPages([page.text], { paged: false });
      if (chunks.reduce((n, c) => n + c.text.length, 0) < MIN_SOURCE_CHARS) return { ok: true, result: { status: "too_short", sourceType: "web", quota: await quota() } };
      const picked = fitPassages(chunks, NOTES_MAX_CHARS);
      sampled = picked.length < chunks.length;
      passages = toPassages(picked.map((c, i) => ({ id: `web-${i}`, text: c.text, page: null })));
      hash = inputHash("notes", picked.map((c) => c.contentHash));
      name = page.title || new URL(page.url).hostname;
      from = page.url;
      const cached = await saveCached(hash, passages, name, from, sampled);
      if (cached) {
        // Read again, but the notes were already made: give the go back.
        await repo.settleAi(day, "notes", false, 0, 0);
        settled = true;
        return { ok: true, result: { ...cached, quota: await quota() } };
      }
    }
    const out = await runAiTask(notesTask(passages, name), appBudget(repo));
    if (!out.ok) {
      // A paragraph of one or two sentences can't give three points: say it's short, not "muddled", so the student doesn't keep retrying (QA feedback).
      if (out.reason === "failed" && sentenceCount(passages) < MIN_NOTE_POINTS) return { ok: true, result: { status: "too_short", sourceType: source.type, quota: await quota() } };
      return { ok: true, result: { status: out.reason, quota: await quota() } };
    }
    tokens = { input: out.inputTokens, output: out.outputTokens };
    const noteId = await saveNotes(subjectId, out.value, from);
    ok = true;
    if (JSON.stringify(out.raw).length <= MAX_CACHE_BYTES) await repo.putAiCache("notes", hash, out.model, out.raw);
    await repo.settleAi(day, "notes", true, tokens.input, tokens.output);
    settled = true;
    revalidatePath(`/subjects/${subjectId}`);
    return { ok: true, result: { status: "made", noteId, title: noteTitle(out.value.title), points: countPoints(out.value), terms: out.value.terms.length, cached: false, sampled, quota: await quota() } };
  } finally {
    if (!ok && !settled) await repo.settleAi(day, "notes", false, tokens.input, tokens.output);
  }

  /** The same text made into notes before: a new note from the cached reply, free. Never the fake generator's reply once real AI is set up. */
  async function saveCached(h: string, ps: Passage[], fallback: string, label: string, wasSampled: boolean): Promise<Omit<Extract<NotesResult, { status: "made" }>, "quota"> | null> {
    const cached = await repo.getAiCache("notes", h);
    if (!cached || (cached.model === "local" && mode !== "local")) return null;
    const notes = normaliseNotes(cached.output, ps, fallback);
    if (!notes) return null;
    const noteId = await saveNotes(subjectId, notes, label);
    revalidatePath(`/subjects/${subjectId}`);
    return { status: "made", noteId, title: noteTitle(notes.title), points: countPoints(notes), terms: notes.terms.length, cached: true, sampled: wasSampled };
  }

  async function saveNotes(subject: string, notes: Parameters<typeof notesDocument>[0], label: string): Promise<string> {
    const doc = notesDocument(notes, label);
    const { id } = await repo.createNote(subject);
    const title = noteTitle(doc.title);
    await repo.updateNote(id, { title, contentJson: doc.contentJson, contentText: doc.contentText });
    await syncNoteChunks(repo, { id, subjectId: subject, title, contentText: doc.contentText });
    return id;
  }
}

const sentenceCount = (ps: Passage[]) => ps.reduce((n, p) => n + passageSentences(p.text).length, 0);
const noteTitle = (t: string) => `Study notes: ${t}`.slice(0, 200);
const countPoints = (n: { sections: { points: unknown[] }[] }) => n.sections.reduce((k, s) => k + s.points.length, 0);
