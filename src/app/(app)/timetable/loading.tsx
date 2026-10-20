/** Loading (timetable.md "States"): header, week bar and an empty grid with three grey slots. */
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading your timetable">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <h1 className="font-display text-[20px] sm:text-[28px]">Timetable</h1>
        <div className="grid grid-cols-2 gap-2 sm:ml-auto sm:flex">
          <button type="button" className="btn btn-primary col-span-2" disabled>Add</button>
          <button type="button" className="btn" disabled>Import timetable</button>
          <button type="button" className="btn" disabled>Add to my calendar</button>
        </div>
      </div>
      <div className="skeleton h-11 w-64 max-w-full" />
      <div className="tt-frame relative h-[480px]">
        <div className="skeleton absolute left-[16%] top-[60px] h-20 w-[11%]" />
        <div className="skeleton absolute left-[44%] top-[160px] h-28 w-[11%]" />
        <div className="skeleton absolute left-[72%] top-[260px] h-16 w-[11%]" />
      </div>
    </div>
  );
}
