"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { signOut } from "@/server/actions/auth";
import { useSound } from "./sound-provider";

/** Phone header (design-system.md "Header navigation (Step 4)"): Subjects, Settings and Sign out behind "⋯". */
export function HeaderMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const id = useId();
  const { play } = useSound();
  const pathname = usePathname();

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("click", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onDoc); document.removeEventListener("keydown", onKey); };
  }, [open]);

  const item = "flex min-h-11 w-full items-center rounded-md px-3 text-left font-bold hover:bg-highlight hover:text-[var(--on-colour)]";
  return (
    <div ref={ref} className="relative sm:hidden">
      <button
        ref={btn} type="button" className="btn btn-sm icon-btn min-h-11" aria-label="Menu" aria-expanded={open} aria-controls={id}
        onClick={() => { play("click"); setOpen(!open); }}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <ul id={id} className="sticker absolute right-0 top-full z-40 mt-2 flex min-w-44 flex-col p-1">
          <li><Link href="/subjects" className={item} aria-current={pathname === "/subjects" ? "page" : undefined} onClick={() => play("click")}>Subjects</Link></li>
          <li><Link href="/settings" className={item} aria-current={pathname === "/settings" ? "page" : undefined} onClick={() => play("click")}>Settings</Link></li>
          <li>
            <form action={signOut}>
              <button type="submit" className={item} onClick={() => play("click")}>Sign out</button>
            </form>
          </li>
        </ul>
      )}
    </div>
  );
}
