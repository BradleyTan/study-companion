import Link from "next/link";
import { ProfileSync } from "@/components/sound-provider";
import { SignOutButton } from "@/components/sign-out-button";
import { getRepo, requireUser } from "@/server/session";

// Every page in here is per-student; never prerender or cache it.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();
  const profile = await (await getRepo()).getProfile();
  return (
    <>
      <ProfileSync {...profile} />
      <header className="sticky top-[env(safe-area-inset-top,0px)] z-30 border-b-[2.5px] border-ink bg-paper">
        <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 px-4 py-2">
          <Link href="/subjects" className="font-display -rotate-2 rounded-md bg-highlight px-2 py-0.5 text-xl text-[var(--on-colour)]">
            StudyNest
          </Link>
          {user.demo && <span className="chip ml-1 hidden sm:inline-flex">Demo mode</span>}
          <div className="ml-auto flex items-center gap-1">
            <Link href="/subjects" className="btn btn-ghost btn-sm hidden sm:inline-flex">Subjects</Link>
            <Link href="/settings" className="btn btn-ghost btn-sm">Settings</Link>
            <SignOutButton />
          </div>
        </nav>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl px-4 pb-24 pt-6">{children}</main>
    </>
  );
}
