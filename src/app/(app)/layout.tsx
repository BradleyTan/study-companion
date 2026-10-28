import Link from "next/link";
import { HeaderMenu } from "@/components/header-menu";
import { NavLink } from "@/components/nav-link";
import { CalendarIcon } from "@/components/timetable/icons";
import { ProfileSync } from "@/components/sound-provider";
import { SignOutButton } from "@/components/sign-out-button";
import { TimerChip } from "@/components/timer/timer-chip";
import { TimerProvider } from "@/components/timer/timer-provider";
import { localWeekStart } from "@/lib/srs/due";
import { nowMs } from "@/lib/time";
import { getRepo, requireUser } from "@/server/session";
import { studyBlocksSoon } from "@/server/timetable";

// Every page in here is per-student; never prerender or cache it.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const repo = await getRepo();
  const profile = await repo.getProfile();
  const now = nowMs();
  // The timer's subject picker and this week's study time (today's tally and the subject page).
  // A failed count only hides the numbers; the timer itself works from this browser.
  const [subjects, sessions, slots] = await Promise.all([
    repo.listSubjects().catch(() => []),
    repo.listStudySessions({ endedSince: localWeekStart(profile.timezone, new Date(now)).toISOString() }).catch(() => null),
    repo.listSlots().catch(() => []),
  ]);
  return (
    <TimerProvider
      subjects={subjects.map((s) => ({ id: s.id, name: s.name, colour: s.colour, emoji: s.emoji }))}
      prefs={{
        focusMin: profile.timerFocusMin, shortMin: profile.timerShortMin, longMin: profile.timerLongMin,
        longEvery: profile.timerLongEvery, autoStart: profile.timerAutoStart, focusQuiet: profile.focusQuiet,
      }}
      sessions={sessions?.map((s) => ({ clientKey: s.clientKey, subjectId: s.subjectId, kind: s.kind, focusedSec: s.focusedSec, completed: s.completed, endedAt: s.endedAt })) ?? null}
      timezone={profile.timezone}
      serverNow={now}
      studyBlocks={studyBlocksSoon(slots, now)}
    >
      <ProfileSync {...profile} />
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 border-b-[2.5px] border-ink bg-paper print:hidden">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl items-center gap-2 px-4 py-2">
          <Link href="/subjects" className="font-display inline-flex min-h-11 shrink-0 -rotate-2 items-center rounded-md bg-highlight px-2 py-0.5 text-xl text-[var(--on-colour)]">
            StudyNest
          </Link>
          {user.demo && <span className="chip ml-1 hidden md:inline-flex">Demo mode</span>}
          <div className="ml-auto flex items-center gap-1">
            <NavLink href="/subjects" className="btn btn-ghost btn-sm hidden sm:inline-flex">Subjects</NavLink>
            <NavLink href="/timetable" className="btn btn-ghost btn-sm hidden sm:inline-flex">Timetable</NavLink>
            <TimerChip />
            <NavLink href="/timetable" className="btn btn-sm icon-btn min-h-11 sm:hidden" label="Timetable"><CalendarIcon /></NavLink>
            <NavLink href="/settings" className="btn btn-ghost btn-sm hidden sm:inline-flex">Settings</NavLink>
            <div className="hidden sm:block"><SignOutButton /></div>
            <HeaderMenu />
          </div>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6">{children}</main>
    </TimerProvider>
  );
}
