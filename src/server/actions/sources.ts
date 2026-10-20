"use server";
import { revalidatePath } from "next/cache";
import { extractFile } from "@/lib/extract";
import { id as idSchema, MAX_TOTAL_BYTES, MAX_UPLOAD_BYTES, UPLOADS_PER_DAY, uploadRequest } from "@/lib/validation";
import { createSignedUpload, readFile, removeFiles, signedDownloadUrl, storagePathFor } from "../files";
import { embedSource } from "../embed";
import { store } from "../repo/demo";
import { getRepo, requireUser } from "../session";
import { firstIssue, type ActionResult } from "./result";


type StartResult = ActionResult<
  { mode: "supabase"; sourceId: string; path: string; token: string } | { mode: "demo"; sourceId: string }
>;

/** Step 1 of an upload: check limits, reserve a row and (with Supabase) a signed upload URL. */
export async function startUpload(raw: unknown): Promise<StartResult> {
  const parsed = uploadRequest.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  const { subjectId, fileName, size } = parsed.data;
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext !== "pdf" && ext !== "pptx") return { ok: false, error: "Only PDF and PPTX files can be uploaded." };

  const user = await requireUser();
  const repo = await getRepo();
  if (!(await repo.getSubject(subjectId))) return { ok: false, error: "Subject not found." };
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const stats = await repo.uploadStats(since);
  if (stats.countSince >= UPLOADS_PER_DAY) return { ok: false, error: `You've uploaded ${UPLOADS_PER_DAY} files in the last 24 hours. Try again tomorrow.` };
  if (stats.totalBytes + size > MAX_TOTAL_BYTES) return { ok: false, error: "You're out of storage space (100 MB). Delete some files first." };

  const sourceId = crypto.randomUUID();
  const storagePath = storagePathFor(user.id, sourceId, fileName);
  await repo.recordUpload(size);
  await repo.createSource({ id: sourceId, subjectId, fileName, kind: ext, sizeBytes: size, storagePath });
  revalidatePath(`/subjects/${subjectId}`);
  if (user.demo) return { ok: true, mode: "demo", sourceId };
  const signed = await createSignedUpload(user, storagePath);
  return { ok: true, mode: "supabase", sourceId, path: signed.path, token: signed.token };
}

/** Demo mode only: the file bytes come through the server action instead of Storage. */
export async function uploadDemoFile(form: FormData): Promise<ActionResult> {
  const user = await requireUser();
  if (!user.demo) return { ok: false, error: "Not available." };
  const sourceId = String(form.get("sourceId") ?? "");
  const file = form.get("file");
  if (!(file instanceof File) || !idSchema.safeParse(sourceId).success) return { ok: false, error: "That upload didn't go through. Try again." };
  if (file.size > MAX_UPLOAD_BYTES) return { ok: false, error: "That file is over 25 MB." };
  const repo = await getRepo();
  const source = await repo.getSource(sourceId);
  if (!source) return { ok: false, error: "That upload didn't go through. Try again." };
  store.files.set(source.storagePath, new Uint8Array(await file.arrayBuffer()));
  return { ok: true };
}

/** Step 2: verify the stored bytes, extract text and save passages. */
export async function processUpload(sourceId: string): Promise<ActionResult<{ status: string }>> {
  if (!idSchema.safeParse(sourceId).success) return { ok: false, error: "File not found." };
  const user = await requireUser();
  const repo = await getRepo();
  const source = await repo.getSource(sourceId);
  if (!source) return { ok: false, error: "File not found." };
  await repo.updateSource(sourceId, { extractStatus: "reading" });

  const bytes = await readFile(user, source.storagePath);
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > MAX_UPLOAD_BYTES) {
    await removeFiles(user, [source.storagePath]);
    await repo.deleteSource(sourceId);
    revalidatePath(`/subjects/${source.subjectId}`);
    return { ok: false, error: bytes && bytes.byteLength > MAX_UPLOAD_BYTES ? "That file is over 25 MB." : "The upload didn't arrive. Try again." };
  }

  // Trust the stored bytes, not the size the browser claimed.
  await repo.updateSource(sourceId, { sizeBytes: bytes.byteLength });
  const result = await extractFile(bytes, source.fileName);
  if (result.status === "rejected") {
    // Never keep a file we wouldn't have accepted.
    await removeFiles(user, [source.storagePath]);
    await repo.deleteSource(sourceId);
    revalidatePath(`/subjects/${source.subjectId}`);
    return { ok: false, error: result.error };
  }
  if (result.status === "failed") {
    await repo.updateSource(sourceId, { extractStatus: "failed", extractError: result.error });
  } else {
    await repo.replaceSourceChunks(sourceId, source.subjectId, result.chunks);
    await repo.updateSource(sourceId, { extractStatus: result.status, pageCount: result.pageCount, extractError: null });
    if (result.status === "ready" && !user.demo) await embedSource(user.id, sourceId);
  }
  revalidatePath(`/subjects/${source.subjectId}`);
  return { ok: true, status: result.status };
}

export async function deleteSource(sourceId: string): Promise<ActionResult> {
  if (!idSchema.safeParse(sourceId).success) return { ok: false, error: "File not found." };
  const user = await requireUser();
  const repo = await getRepo();
  const source = await repo.getSource(sourceId);
  if (!source) return { ok: false, error: "File not found." };
  await removeFiles(user, [source.storagePath]);
  await repo.deleteSource(sourceId);
  revalidatePath(`/subjects/${source.subjectId}`);
  return { ok: true };
}

export async function getDownloadUrl(sourceId: string): Promise<ActionResult<{ url: string }>> {
  if (!idSchema.safeParse(sourceId).success) return { ok: false, error: "File not found." };
  const user = await requireUser();
  const source = await (await getRepo()).getSource(sourceId);
  if (!source) return { ok: false, error: "File not found." };
  // Only hand out files whose contents have been checked.
  if (source.extractStatus === "pending" || source.extractStatus === "reading") return { ok: false, error: "This file is still being checked." };
  const url = user.demo ? `/api/demo-file/${sourceId}` : await signedDownloadUrl(user, source.storagePath, source.fileName);
  return url ? { ok: true, url } : { ok: false, error: "We couldn't open that file." };
}
