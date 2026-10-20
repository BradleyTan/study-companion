/** Note editor skeleton (polish.md P2-6): title, toolbar and the paper sheet. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading note">
      <div className="skeleton h-10 w-2/3" />
      <div className="skeleton h-14" />
      <div className="skeleton h-[50vh]" />
    </div>
  );
}
