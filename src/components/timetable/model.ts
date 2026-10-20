import type { SubjectColour } from "@/lib/subjects";
import type { SlotKind } from "@/lib/timetable/slots";
import type { TimetableSlot } from "@/server/repo/types";

export type TtSubject = { id: string; name: string; colour: SubjectColour; emoji: string };
export type Slot = TimetableSlot;

/** What the slot form opens with. */
export type FormStart =
  | { mode: "new"; date: string; startMin: number; endMin: number; kind?: SlotKind; subjectId?: string | null }
  | { mode: "edit"; slot: Slot; occDate: string; date: string; startMin: number; endMin: number };

/** A slot as drawn: one occurrence in the shown week. */
export type Placed = { slot: Slot; occDate: string; day: number; startMin: number; endMin: number; start: number; end: number };

const LAST_SUBJECT = "studynest.timetable.lastSubject";
export function lastSubject(): string | null {
  try { return localStorage.getItem(LAST_SUBJECT) || null; } catch { return null; }
}
export function rememberSubject(id: string | null): void {
  try { localStorage.setItem(LAST_SUBJECT, id ?? ""); } catch {}
}
