import { calendarFile } from "@/server/calendar";

// The private calendar feed (timetable.md "Calendar link panel"): /api/calendar/<token>.ics.
// Public by design (Google, Apple and Outlook fetch it without signing in): the 256-bit token is
// the only key. Never cached by shared caches (each student's file is private), no cookies read,
// no AI, at most 300 slots.
export const dynamic = "force-dynamic";

const PRIVATE = {
  "Cache-Control": "private, no-store, max-age=0",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
};

async function respond(params: Promise<{ token: string }>, head: boolean): Promise<Response> {
  const { token: segment } = await params;
  const token = segment.endsWith(".ics") ? segment.slice(0, -4) : null;
  let body: string | null = null;
  try {
    body = token ? await calendarFile(token) : null;
  } catch (e) {
    console.error("calendar feed", e instanceof Error ? e.message : e);
    return new Response(head ? null : "Try again later.\n", { status: 503, headers: { ...PRIVATE, "Content-Type": "text/plain; charset=utf-8", "Retry-After": "600" } });
  }
  if (body === null) {
    return new Response(head ? null : "Not found.\n", { status: 404, headers: { ...PRIVATE, "Content-Type": "text/plain; charset=utf-8" } });
  }
  return new Response(head ? null : body, {
    status: 200,
    headers: { ...PRIVATE, "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": 'inline; filename="studynest.ics"' },
  });
}

export async function GET(_req: Request, ctx: RouteContext<"/api/calendar/[token]">) {
  return respond(ctx.params, false);
}

export async function HEAD(_req: Request, ctx: RouteContext<"/api/calendar/[token]">) {
  return respond(ctx.params, true);
}
