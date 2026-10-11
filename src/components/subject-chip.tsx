import { SUBJECT_COLOURS, type SubjectColour } from "@/lib/subjects";

export function SubjectChip({ name, emoji, colour }: { name: string; emoji: string; colour: SubjectColour }) {
  return (
    <span className="chip on-colour" style={{ background: SUBJECT_COLOURS[colour] }}>
      <span role="img" aria-hidden="true">{emoji}</span>
      {name}
    </span>
  );
}
