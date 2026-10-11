import { NextResponse } from "next/server";
import { getCurrentUser, getRepo } from "@/server/session";

export async function GET() {
  if (!(await getCurrentUser())) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const bundle = await (await getRepo()).exportAll();
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="studynest-export-${day}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
