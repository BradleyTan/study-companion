import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SourceText, type SourcePage } from "@/components/source-text";
import { SUBJECT_COLOURS } from "@/lib/subjects";
import { findLoose } from "@/lib/text/find";
import { id as idSchema } from "@/lib/validation";
import { passageTarget } from "@/server/passages";
import { getRepo } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/subjects/[id]/sources/[sourceId]">): Promise<Metadata> {
  const { sourceId } = await params;
  if (!idSchema.safeParse(sourceId).success) return {};
  const s = await (await getRepo()).getSource(sourceId);
  return { title: s?.fileName ?? "Lecture file" };
}

/** Read-only text of a lecture file, page by page, with the cited passage marked (flashcards.md "Source links"). */
export default async function SourcePageView({ params, searchParams }: PageProps<"/subjects/[id]/sources/[sourceId]">) {
  const { id, sourceId } = await params;
  if (!idSchema.safeParse(id).success || !idSchema.safeParse(sourceId).success) notFound();
  const repo = await getRepo();
  const [subject, source] = await Promise.all([repo.getSubject(id), repo.getSource(sourceId)]);
  if (!subject || !source || source.subjectId !== subject.id) notFound();
  const [chunks, target] = await Promise.all([repo.listChunks({ sourceId }), passageTarget(repo, { sourceId }, await searchParams)]);

  // Find the passage to mark: the card's quote first, then the whole passage.
  let marked: { ordinal: number; start: number; end: number } | null = null;
  if (target) {
    for (const needle of [target.quote, target.text]) {
      if (!needle || marked) continue;
      for (const c of chunks) {
        const hit = findLoose(c.text, needle);
        if (hit) { marked = { ordinal: c.ordinal, ...hit }; break; }
      }
    }
  }

  const pages = new Map<number, SourcePage>();
  for (const c of [...chunks].sort((a, b) => a.ordinal - b.ordinal)) {
    const n = c.page ?? 1;
    const page = pages.get(n) ?? { page: n, blocks: [] };
    const m = marked?.ordinal === c.ordinal ? marked : null;
    page.blocks.push(m
      ? { before: c.text.slice(0, m.start), mark: c.text.slice(m.start, m.end), after: c.text.slice(m.end) }
      : { before: c.text, mark: null, after: "" });
    pages.set(n, page);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Link href={`/subjects/${subject.id}`} className="inline-flex min-h-11 items-center font-bold underline-offset-4 hover:underline">← {subject.name}</Link>
        <span className="chip on-colour" style={{ background: SUBJECT_COLOURS[subject.colour] }}>
          <span role="img" aria-label={subject.name}>{subject.emoji}</span> {subject.name}
        </span>
      </div>
      <SourceText
        sourceId={source.id}
        fileName={source.fileName}
        kind={source.kind}
        pages={[...pages.values()].sort((a, b) => a.page - b.page)}
        missing={!!target && !marked}
        quote={target?.quote ?? null}
        markedPage={target?.page ?? null}
        canOpen={source.extractStatus !== "pending" && source.extractStatus !== "reading"}
      />
    </div>
  );
}
