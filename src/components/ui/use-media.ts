"use client";
import { useSyncExternalStore } from "react";

/** A CSS media query as React state (false on the server and the first client render). */
export function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(query);
      m.addEventListener("change", cb);
      return () => m.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Phone layout (< 640 px, design-system.md). */
export const usePhone = () => useMedia("(max-width: 639px)");
