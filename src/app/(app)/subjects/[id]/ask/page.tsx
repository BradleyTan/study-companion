import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChatScreen } from "@/components/chat/chat-screen";
import { safeTimeZone } from "@/lib/srs/due";
import { id as idSchema } from "@/lib/validation";
import { subjectDue } from "@/server/cards";
import { chatPageData } from "@/server/chat";
import { getRepo } from "@/server/session";

export async function generateMetadata({ params }: PageProps<"/subjects/[id]/ask">): Promise<Metadata> {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) return {};
  const s = await (await getRepo()).getSubject(id);
  return { title: s ? `Ask your ${s.name} notes` : "Ask your notes" };
}

export default async function AskPage({ params }: PageProps<"/subjects/[id]/ask">) {
  const { id } = await params;
  if (!idSchema.safeParse(id).success) notFound();
  const repo = await getRepo();
  const subject = await repo.getSubject(id);
  if (!subject) notFound();
  const [due, profile] = await Promise.all([subjectDue(repo, id).catch(() => null), repo.getProfile()]);
  const data = await chatPageData(repo, subject, { dueCards: due?.total ?? 0 });
  return <ChatScreen data={data} tz={safeTimeZone(profile.timezone)} />;
}
