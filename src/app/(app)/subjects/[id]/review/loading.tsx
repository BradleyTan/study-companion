export default function Loading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-label="Loading your review">
      <div className="skeleton h-8 w-full" />
      <div className="skeleton mx-auto h-[320px] w-full sm:w-[560px] lg:w-[640px]" />
      <button type="button" className="btn btn-primary mx-auto min-h-[64px] w-full sm:w-[560px] lg:w-[640px]" disabled>Show answer</button>
    </div>
  );
}
