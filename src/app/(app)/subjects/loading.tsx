export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading your subjects">
      <div className="h-10 w-64 rounded-md bg-[var(--grid)]" />
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2].map((i) => <div key={i} className="sticker-flat h-36 animate-pulse bg-[var(--grid)]" />)}
      </div>
    </div>
  );
}
