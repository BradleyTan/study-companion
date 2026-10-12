"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SubjectColour } from "@/lib/subjects";
import { id as idSchema, subjectInput } from "@/lib/validation";
import { removeFiles } from "../files";
import { getRepo, requireUser } from "../session";
import { firstIssue, type ActionResult } from "./result";

const MAX_SUBJECTS = 50;

export async function createSubject(raw: unknown): Promise<ActionResult<{ id: string }>> {
  const parsed = subjectInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  if ((await repo.listSubjects()).length >= MAX_SUBJECTS) {
    return { ok: false, error: `You can have up to ${MAX_SUBJECTS} subjects. Delete one you no longer need first.` };
  }
  const s = await repo.createSubject({ ...parsed.data, colour: parsed.data.colour as SubjectColour });
  revalidatePath("/subjects");
  return { ok: true, id: s.id };
}

export async function updateSubject(id: string, raw: unknown): Promise<ActionResult> {
  const parsed = subjectInput.safeParse(raw);
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Subject not found." };
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const repo = await getRepo();
  await repo.updateSubject(id, { ...parsed.data, colour: parsed.data.colour as SubjectColour });
  revalidatePath(`/subjects/${id}`);
  revalidatePath("/subjects");
  return { ok: true };
}

export async function deleteSubject(id: string): Promise<ActionResult> {
  if (!idSchema.safeParse(id).success) return { ok: false, error: "Subject not found." };
  const user = await requireUser();
  const repo = await getRepo();
  // Remove stored files first; rows cascade when the subject goes.
  const sources = await repo.listSources(id);
  await removeFiles(user, sources.map((s) => s.storagePath));
  await repo.deleteSubject(id);
  revalidatePath("/subjects");
  redirect("/subjects");
}
