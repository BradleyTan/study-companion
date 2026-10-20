import type { Metadata } from "next";
import { TimetableScreen } from "@/components/timetable/timetable-screen";
import { nowMs } from "@/lib/time";
import { dayOf } from "@/lib/timetable/dates";
import { SLOT_KINDS, type SlotKind } from "@/lib/timetable/slots";
import { getRepo } from "@/server/session";

export const metadata: Metadata = { title: "Timetable" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The student's week (docs/design/screens/timetable.md). */
export default async function TimetablePage({ searchParams }: PageProps<"/timetable">) {
  const sp = await searchParams;
  const repo = await getRepo();
  const [profile, subjects, slots] = await Promise.all([repo.getProfile(), repo.listSubjects(), repo.listSlots()]);
  const week = one(sp.week);
  const subject = one(sp.subject);
  const kind = one(sp.kind);
  const live = subjects;
  return (
    <TimetableScreen
      slots={slots}
      subjects={live.map((s) => ({ id: s.id, name: s.name, colour: s.colour, emoji: s.emoji }))}
      timezone={profile.timezone}
      weekStart={profile.weekStart}
      serverNow={nowMs()}
      initialWeek={week && /^\d{4}-\d{2}-\d{2}$/.test(week) && Number.isFinite(dayOf(week)) ? week : null}
      openAdd={one(sp.add) === "1" ? {
        subjectId: subject && UUID.test(subject) && live.some((s) => s.id === subject) ? subject : null,
        kind: (SLOT_KINDS as readonly string[]).includes(kind ?? "") ? (kind as SlotKind) : "class",
      } : null}
    />
  );
}
