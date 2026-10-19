// Which subject a new round is for (timer.md "Subject"): the subject of the current page, else
// the subject of a timetable Study block happening now (timetable comes in Step 4 part 2), else
// the last one used, else "No subject". Only subjects the student still has count.

const SUBJECT_PATH = /^\/subjects\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

export function subjectFromPath(pathname: string | null): string | null {
  return pathname?.match(SUBJECT_PATH)?.[1]?.toLowerCase() ?? null;
}

export function defaultSubjectId(o: { pathname: string | null; studyBlockSubjectId?: string | null; lastUsed: string | null; subjectIds: ReadonlySet<string> }): string | null {
  for (const id of [subjectFromPath(o.pathname), o.studyBlockSubjectId ?? null, o.lastUsed]) if (id && o.subjectIds.has(id)) return id;
  return null;
}
