import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MindmapScreen } from "@/components/mindmap/mindmap-screen";
import { MINDMAP_MAX_CHARS } from "@/lib/ai/tasks";
import { id as idSchema } from "@/lib/validation";
import { quotaFor } from "@/server/ai";
import { mindmapInput, mindmapSourceOptions, mindmapView } from "@/server/mindmap";
import { getRepo } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/subjects/[id]/mindmap">): Promise<Metadata> {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return {};
  const s = await (await getRepo()).getSubject(id);
  return { title: s ? `${s.name} mindmap` : "Mindmap" };
}

export default async function MindmapPage({ params }: PageProps<"/subjects/[id]/mindmap">) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const repo = await getRepo();
  const subject = await repo.getSubject(id);
  if (!subject) notFound();
  const [map, quota, { options, chunks }] = await Promise.all([repo.getMindmap(id), quotaFor(repo, "mindmap"), mindmapSourceOptions(repo, id)]);
  // "Changed" compares the map's hash with the same selection's hash today.
  const initial = map ? { ...mindmapView(map, mindmapInput(subject.name, options, chunks, map.sources).hash), sources: map.sources } : null;
  return (
    <MindmapScreen
      key={map?.createdAt ?? "none"}
      subject={{ id: subject.id, name: subject.name, colour: subject.colour, emoji: subject.emoji }}
      initial={initial}
      quota={quota}
      options={options}
      maxChars={MINDMAP_MAX_CHARS}
    />
  );
}
