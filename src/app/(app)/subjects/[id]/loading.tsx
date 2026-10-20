/** Subject page skeleton (polish.md P2-6): breadcrumb, header band, the four tools, Notes and Lecture files. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-8" aria-busy="true" aria-label="Loading subject">
      <div className="flex flex-col gap-3">
        <div className="skeleton h-6 w-32" />
        <div className="skeleton h-24" />
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-24" />)}
      </div>
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div className="skeleton h-40" />
        <div className="skeleton h-40" />
      </div>
    </div>
  );
}
