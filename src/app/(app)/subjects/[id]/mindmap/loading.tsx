export default function MindmapLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading mindmap">
      <div className="skeleton h-8 w-40" />
      <div className="mindmap-frame flex items-center justify-center">
        <div className="skeleton h-14 w-40" />
      </div>
    </div>
  );
}
