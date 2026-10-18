export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading your weak topics">
      <div className="skeleton h-6 w-40" />
      <div className="skeleton h-10 w-56" />
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-5">
        {[0, 1, 2].map((i) => <div key={i} className="skeleton h-28" />)}
      </div>
    </div>
  );
}
