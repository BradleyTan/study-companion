export default function Loading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-label="Loading your quiz">
      <div className="skeleton h-10" />
      <div className="skeleton mx-auto h-64 w-full max-w-[680px]" />
      <button type="button" className="btn btn-primary mx-auto" disabled>Check</button>
    </div>
  );
}
