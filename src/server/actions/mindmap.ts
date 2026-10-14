"use server";
import { revalidatePath } from "next/cache";
import { aiMode } from "@/lib/ai/providers";
import { runAiTask } from "@/lib/ai/run";
import { mindmapGraph, normaliseMindmap, positionsInput } from "@/lib/ai/schemas";
import { MIN_MINDMAP_CHARS, MINDMAP_MAX_CHARS, mindmapTask, toPassages } from "@/lib/ai/tasks";
import { DAILY_ATTEMPTS, DAILY_LIMITS, type Quota } from "@/lib/limits/ai";
import { withoutPositions, withPositions } from "@/lib/mindmap/layout";
import { id as idSchema, makeMindmapInput } from "@/lib/validation";
import { appBudget, quotaFor, studentDay } from "../ai";
import { mindmapInput, mindmapSourceOptions, mindmapView, type MindmapView } from "../mindmap";
import { passageView, type PassageView } from "../passages";
import { getRepo } from "../session";
import { firstIssue, type ActionResult } from "./result";

const MAX_CACHE_BYTES = 200_000;

export type MindmapResult =
  | { status: "made"; view: MindmapView; quota: Quota }
  | { status: "too_short" | "too_long" | "limit" | "allowance" | "failed" | "not_configured"; quota: Quota };

/**
 * Makes (or remakes) the subject's mindmap. Without `force`, the same notes reuse the
 * cached map for free; "Regenerate" with unchanged notes passes `force` to get a fresh one.
 */
export async function makeMindmap(raw: unknown): Promise<ActionResult<{ result: MindmapResult }>> {
  const parsed = makeMindmapInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { subjectId, selection, force } = parsed.data;
  const repo = await getRepo();
  const subject = await repo.getSubject(subjectId);
  if (!subject) return { ok: false, error: "Subject not found." };
  const quota = () => quotaFor(repo, "mindmap");

  const { options, chunks } = await mindmapSourceOptions(repo, subjectId);
  const input = mindmapInput(subject.name, options, chunks, selection);
  if (input.totalChars < MIN_MINDMAP_CHARS) return { ok: true, result: { status: "too_short", quota: await quota() } };
  // A hand-picked selection must fit in one map; "everything" is sampled evenly instead.
  if (!selection.all && input.totalChars > MINDMAP_MAX_CHARS) return { ok: true, result: { status: "too_long", quota: await quota() } };
  const passages = toPassages(input.picked);

  // Never reuse the fake generator's output once real AI is set up.
  const mode = aiMode();
  if (!force) {
    const cached = await repo.getAiCache("mindmap", input.hash);
    const graph = cached && (cached.model !== "local" || mode === "local") ? normaliseMindmap(cached.output, passages, subject.name) : null;
    if (graph) {
      const map = await repo.saveMindmap(subjectId, { graph, inputHash: input.hash, sources: input.sources });
      revalidatePath(`/subjects/${subjectId}`);
      return { ok: true, result: { status: "made", view: mindmapView(map, input.hash), quota: await quota() } };
    }
  }

  if (mode === "off") return { ok: true, result: { status: "not_configured", quota: await quota() } };
  const day = await studentDay(repo);
  if (!(await repo.reserveAi(day, "mindmap", DAILY_LIMITS.mindmap, DAILY_ATTEMPTS.mindmap))) return { ok: true, result: { status: "limit", quota: await quota() } };
  let ok = false;
  let tokens = { input: 0, output: 0 };
  try {
    const out = await runAiTask(mindmapTask(passages, subject.name), appBudget(repo));
    if (!out.ok) return { ok: true, result: { status: out.reason, quota: await quota() } };
    tokens = { input: out.inputTokens, output: out.outputTokens };
    const map = await repo.saveMindmap(subjectId, { graph: out.value, inputHash: input.hash, sources: input.sources });
    ok = true;
    if (JSON.stringify(out.raw).length <= MAX_CACHE_BYTES) await repo.putAiCache("mindmap", input.hash, out.model, out.raw);
    await repo.settleAi(day, "mindmap", true, tokens.input, tokens.output);
    revalidatePath(`/subjects/${subjectId}`);
    return { ok: true, result: { status: "made", view: mindmapView(map, input.hash), quota: await quota() } };
  } finally {
    if (!ok) await repo.settleAi(day, "mindmap", false, tokens.input, tokens.output);
  }
}

/** Saves dragged node positions (whole px). */
export async function saveMindmapPositions(raw: unknown): Promise<ActionResult> {
  const parsed = positionsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  const map = await repo.getMindmap(parsed.data.subjectId);
  if (!map) return { ok: false, error: "This mindmap is gone." };
  const graph = mindmapGraph.safeParse(withPositions(map.graph, parsed.data.positions));
  if (!graph.success) return { ok: false, error: "Layout not saved." };
  await repo.updateMindmapGraph(parsed.data.subjectId, graph.data);
  return { ok: true };
}

export async function resetMindmapLayout(subjectId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(subjectId).success) return { ok: false, error: "Subject not found." };
  const repo = await getRepo();
  const map = await repo.getMindmap(subjectId);
  if (!map) return { ok: false, error: "This mindmap is gone." };
  await repo.updateMindmapGraph(subjectId, withoutPositions(map.graph));
  return { ok: true };
}

/** The passage behind a mindmap node. `null` passage = the note or file was deleted. */
export async function getPassage(chunkId: string): Promise<ActionResult<{ passage: PassageView | null }>> {
  if (!idSchema.safeParse(chunkId).success) return { ok: false, error: "Passage not found." };
  const repo = await getRepo();
  const [chunk] = await repo.getChunks([chunkId]);
  return { ok: true, passage: chunk ? await passageView(repo, chunk) : null };
}
