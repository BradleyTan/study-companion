import "server-only";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { store } from "./repo/demo";
import type { CurrentUser } from "./session";

const BUCKET = "sources";

export function storagePathFor(userId: string, sourceId: string, fileName: string) {
  const safe = fileName.normalize("NFKD").replace(/[^\w.\- ]+/g, "").replace(/\s+/g, "_").slice(-120) || "file";
  return `${userId}/${sourceId}/${safe}`;
}

/**
 * Signed upload target so big files go straight from the browser to Storage (Vercel caps
 * request bodies at 4.5 MB). Students have no Storage insert policy, so this one-path URL,
 * created after the limits pass, is the only way a file gets in.
 */
export async function createSignedUpload(user: CurrentUser, path: string) {
  if (!path.startsWith(`${user.id}/`)) throw new Error("Bad upload path");
  const { data, error } = await createSupabaseAdminClient().storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(`createSignedUploadUrl: ${error.message}`);
  return { path: data.path, token: data.token };
}

export async function readFile(user: CurrentUser, path: string): Promise<Uint8Array | null> {
  if (!path.startsWith(`${user.id}/`)) return null;
  if (user.demo) return store.files.get(path) ?? null;
  const db = await createSupabaseServerClient();
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export async function removeFiles(user: CurrentUser, paths: string[]) {
  const mine = paths.filter((p) => p.startsWith(`${user.id}/`));
  if (!mine.length) return;
  if (user.demo) return mine.forEach((p) => store.files.delete(p));
  const db = await createSupabaseServerClient();
  await db.storage.from(BUCKET).remove(mine);
}

export async function signedDownloadUrl(user: CurrentUser, path: string, fileName: string): Promise<string | null> {
  if (!path.startsWith(`${user.id}/`)) return null;
  if (user.demo) return null;
  const db = await createSupabaseServerClient();
  const { data } = await db.storage.from(BUCKET).createSignedUrl(path, 60, { download: fileName });
  return data?.signedUrl ?? null;
}
