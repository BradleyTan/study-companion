"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { useSound } from "./sound-provider";

/** Header link that marks the current page (aria-current and a highlight underline). */
export function NavLink({ href, children, className = "", label }: { href: "/subjects" | "/timetable" | "/settings"; children: ReactNode; className?: string; label?: string }) {
  const pathname = usePathname();
  const { play } = useSound();
  const current = pathname === href || pathname.startsWith(`${href}/`);
  return (
    <Link
      href={href} className={`${className} nav-link`} aria-current={current ? "page" : undefined} aria-label={label} title={label}
      onClick={() => play("click")}
    >
      {children}
    </Link>
  );
}
