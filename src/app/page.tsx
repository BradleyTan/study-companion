import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/session";

const STICKERS = [
  { emoji: "🗂️", title: "A folder per subject", text: "Notes and lecture slides live together, one colour per course." },
  { emoji: "🃏", title: "Flashcards that come back", text: "Cards made from your notes return right before you'd forget them.", soon: true },
  { emoji: "✅", title: "Quizzes on your weak spots", text: "Questions you miss come back in later quizzes until they stick.", soon: true },
  { emoji: "⏱️", title: "Focus timer and timetable", text: "Pomodoro sessions logged per subject, plus your study plan.", soon: true },
];

export default async function Home({ searchParams }: PageProps<"/">) {
  if (await getCurrentUser()) redirect("/subjects");
  const { deleted } = await searchParams;
  return (
    <main id="main" className="mx-auto flex min-h-dvh max-w-5xl flex-col gap-10 px-4 py-10">
      {deleted && <p role="status" className="chip chip-ready self-start">Your account and everything in it has been deleted.</p>}
      <section className="flex flex-col items-start gap-5">
        <span className="font-display -rotate-2 rounded-md bg-highlight px-3 py-1 text-2xl text-[var(--on-colour)]">StudyNest</span>
        <h1 className="font-display max-w-3xl text-5xl leading-tight sm:text-6xl">Your whole course, one notebook.</h1>
        <p className="max-w-[60ch] text-lg text-ink-soft">
          Keep notes and lecture files for every subject in one place, then turn them into flashcards, quizzes and a study plan.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link href="/login" className="btn btn-primary">Start studying</Link>
          <Link href="/privacy" className="btn btn-ghost">How we handle your notes</Link>
        </div>
      </section>
      <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2" role="list">
        {STICKERS.map((s, i) => (
          <li key={s.title} className="sticker flex gap-4 p-5" style={{ rotate: i % 2 ? "0.8deg" : "-0.8deg" }}>
            <span className="text-4xl" aria-hidden="true">{s.emoji}</span>
            <div>
              <h2 className="text-lg font-bold">{s.title} {s.soon && <span className="chip ml-1">Coming soon</span>}</h2>
              <p className="text-ink-soft">{s.text}</p>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
