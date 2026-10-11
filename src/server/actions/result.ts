export type ActionResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export function firstIssue(e: { issues: { message: string }[] }): string {
  return e.issues[0]?.message ?? "Something in that form isn't right.";
}
