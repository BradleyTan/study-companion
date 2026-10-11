import { NextResponse } from "next/server";
import { readFile } from "@/server/files";
import { getCurrentUser, getRepo } from "@/server/session";

// Demo mode only: serves a demo student's own uploaded file back to them.
export async function GET(_req: Request, ctx: RouteContext<"/api/demo-file/[id]">) {
  const user = await getCurrentUser();
  if (!user?.demo) return new NextResponse("Not found", { status: 404 });
  const { id } = await ctx.params;
  const source = await (await getRepo()).getSource(id).catch(() => null);
  const bytes = source ? await readFile(user, source.storagePath) : null;
  if (!source || !bytes) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": source.kind === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      // Always download, never render inline on our origin.
      "Content-Disposition": `attachment; filename="${encodeURIComponent(source.fileName)}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
    },
  });
}
