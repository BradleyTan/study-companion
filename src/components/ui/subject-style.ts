import type { CSSProperties } from "react";
import { SUBJECT_COLOURS, type SubjectColour } from "@/lib/subjects";

/** Sets `--subject` for a page or card (design-system.md "Step 2 additions"). */
export function subjectStyle(colour: SubjectColour, extra: CSSProperties = {}): CSSProperties {
  return { ["--subject" as string]: SUBJECT_COLOURS[colour], ...extra };
}
