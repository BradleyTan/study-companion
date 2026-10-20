"use server";
import { STUDY_LOG_MAX_AGE_MS, studySessionInput } from "@/lib/validation";
import { getRepo } from "../session";
import { firstIssue, type ActionResult } from "./result";

// Study timer (timer.md "Logging"). A public endpoint like every server action: the round is
// validated, its subject must be the student's own (another student's or a deleted subject's id
// is logged as "No subject"), and the client key makes a retried save log once.
// `ok: false` means the server will never take this round, so the browser drops it from its
// queue; a thrown error (offline, database down) means "try again later".

const CLOCK_SKEW_MS = 5 * 60 * 1000;

export async function logStudySession(raw: unknown): Promise<ActionResult<{ id: string; subjectId: string | null }>> {
  const parsed = studySessionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const input = parsed.data;
  const now = Date.now();
  if (Date.parse(input.endedAt) > now + CLOCK_SKEW_MS) return { ok: false, error: "That round hasn't ended yet." };
  if (Date.parse(input.startedAt) < now - STUDY_LOG_MAX_AGE_MS) return { ok: false, error: "That round is too old to save." };

  const repo = await getRepo();
  const subjectId = input.subjectId && (await repo.getSubject(input.subjectId)) ? input.subjectId : null;
  try {
    const { session } = await repo.addStudySession({ ...input, subjectId });
    return { ok: true, id: session.id, subjectId: session.subjectId };
  } catch (e) {
    if (e instanceof Error && e.message.includes("study session limit reached")) {
      return { ok: false, error: "Your study log is full." };
    }
    throw e;
  }
}
