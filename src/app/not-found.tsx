import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main" className="flex min-h-[60dvh] items-center justify-center px-4">
      <div className="sticker flex max-w-md flex-col items-center gap-3 p-6 text-center">
        <p className="font-display text-3xl">This page fell out of the notebook</p>
        <p className="text-ink-soft">It may have been deleted, or the link is wrong.</p>
        <Link href="/subjects" className="btn btn-primary">Back to your subjects</Link>
      </div>
    </main>
  );
}
