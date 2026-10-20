import type { Metadata } from "next";
import { TimerView } from "@/components/timer/timer-view";

export const metadata: Metadata = { title: "Study timer" };

/** Focus view (timer.md): the timer full size; the header stays, nothing else on the page. */
export default function TimerPage() {
  return (
    <div className="flex flex-col items-center gap-6">
      <h1 id="timer-page-title" tabIndex={-1} className="font-display self-stretch text-left text-3xl sm:text-4xl">Study timer</h1>
      <TimerView variant="page" />
    </div>
  );
}
