"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { settingsUpdate } from "@/lib/validation";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase/server";
import { demoDeleteUser } from "../repo/demo";
import { removeFiles } from "../files";
import { DEMO_COOKIE, getRepo, requireUser } from "../session";
import { firstIssue, type ActionResult } from "./result";

export async function updateSettings(raw: unknown): Promise<ActionResult> {
  const parsed = settingsUpdate.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstIssue(parsed.error) };
  await (await getRepo()).updateProfile(parsed.data);
  return { ok: true };
}

export async function deleteAccount(confirmText: string): Promise<ActionResult> {
  if (confirmText !== "DELETE") return { ok: false, error: "Type DELETE in capitals to confirm." };
  const user = await requireUser();
  if (user.demo) {
    demoDeleteUser(user.id);
    (await cookies()).delete(DEMO_COOKIE);
    redirect("/?deleted=1");
  }
  // Deleting everything needs a recent sign-in, so an unattended laptop isn't enough.
  const signedIn = user.lastSignInAt ? Date.parse(user.lastSignInAt) : 0;
  if (Date.now() - signedIn > 10 * 60 * 1000) {
    return { ok: false, error: "For safety, sign out and sign in again, then delete your account within 10 minutes." };
  }
  const repo = await getRepo();
  // Files aren't covered by the database cascade, so remove them first.
  const paths: string[] = [];
  for (const s of await repo.listSubjects()) paths.push(...(await repo.listSources(s.id)).map((x) => x.storagePath));
  await removeFiles(user, paths);
  const admin = createSupabaseAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { ok: false, error: "We couldn't delete your account. Please try again." };
  await (await createSupabaseServerClient()).auth.signOut();
  redirect("/?deleted=1");
}
