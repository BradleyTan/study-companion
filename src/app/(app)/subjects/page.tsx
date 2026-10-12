import type { Metadata } from "next";
import { SubjectsGrid } from "@/components/subjects-grid";
import { getRepo } from "@/server/session";

export const metadata: Metadata = { title: "Your subjects" };

export default async function SubjectsPage() {
  const subjects = await (await getRepo()).listSubjects();
  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-display text-4xl">Your subjects</h1>
      <SubjectsGrid subjects={subjects} />
    </div>
  );
}
