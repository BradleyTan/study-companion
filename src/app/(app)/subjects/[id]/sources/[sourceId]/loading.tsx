export default function SourceLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading file">
      <div className="skeleton h-8 w-48" />
      <div className="skeleton h-40" />
      <div className="skeleton h-40" />
    </div>
  );
}
