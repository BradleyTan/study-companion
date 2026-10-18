export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading your chat">
      <div className="skeleton h-6 w-40" />
      <div className="skeleton h-9 w-56" />
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-4">
        <div className="skeleton h-12 w-2/3 self-end" />
        <div className="skeleton h-28 w-4/5" />
        <div className="skeleton h-12 w-1/2 self-end" />
      </div>
    </div>
  );
}
