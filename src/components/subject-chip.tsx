import { SUBJECT_COLOURS, type SubjectColour } from "@/lib/subjects";

/** The subject's colour chip beside a breadcrumb. A long name is cut with "…" so it never pushes a 375 px page sideways. */
export function SubjectChip({ name, emoji, colour }: { name: string; emoji: string; colour: SubjectColour }) {
  return (
    <span className="chip on-colour max-w-full" style={{ background: SUBJECT_COLOURS[colour] }} title={name}>
      <span role="img" aria-hidden="true">{emoji}</span>
      <span className="min-w-0 truncate">{name}</span>
    </span>
  );
}
