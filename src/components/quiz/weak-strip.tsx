"use client";
import Link from "next/link";
import { topNames } from "@/lib/quiz/weak";
import { useSound } from "../sound-provider";

/** Subject page strip under the study tools (subject.md): only while open weak topics exist. */
export function WeakStrip({ subjectId, count, names }: { subjectId: string; count: number; names: string[] }) {
  const { play } = useSound();
  if (count === 0) return null;
  const { shown, more } = topNames(names);
  const label = `${count} weak ${count === 1 ? "topic" : "topics"}`;
  return (
    <div className="strip" data-testid="weak-strip">
      <span aria-hidden="true" className="text-xl">🎯</span>
      <p className="min-w-0 flex-1 truncate">
        <span aria-hidden="true"><strong>{label}:</strong> {shown}{more ? ` +${more}` : ""}</span>
        <span className="sr-only">{label}: {names.join(", ")}</span>
      </p>
      <Link href={`/subjects/${subjectId}/weak-topics`} className="btn btn-sm" aria-label={`Practise ${label}`} onClick={() => play("click")}>Practise</Link>
    </div>
  );
}
