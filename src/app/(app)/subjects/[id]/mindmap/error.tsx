"use client";
import { Button } from "@/components/ui/button";

export default function MindmapError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div role="alert" className="sticker mx-auto mt-10 flex max-w-md flex-col items-center gap-3 p-6 text-center">
      <p className="font-display text-2xl">We couldn&apos;t load your mindmap.</p>
      <Button variant="primary" onClick={reset}>Try again</Button>
    </div>
  );
}
