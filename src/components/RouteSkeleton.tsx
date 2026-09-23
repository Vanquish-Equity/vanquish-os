export default function RouteSkeleton({
  variant = "default",
}: {
  variant?: "default" | "board" | "detail" | "table";
}) {
  const rows = variant === "board" ? 3 : variant === "table" ? 7 : 4;

  return (
    <div className="animate-pulse p-6 lg:p-8" aria-busy="true" aria-label="Loading">
      <div className="mb-7 flex items-center justify-between gap-4">
        <div>
          <div className="h-7 w-44 rounded bg-neutral-200" />
          <div className="mt-2 h-3 w-64 rounded bg-neutral-100" />
        </div>
        <div className="h-9 w-28 rounded-lg bg-neutral-100" />
      </div>

      {variant === "board" ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, column) => (
            <div key={column} className="rounded-xl border border-neutral-100 p-3">
              <div className="mb-4 h-4 w-24 rounded bg-neutral-200" />
              {Array.from({ length: rows }, (_, row) => (
                <div key={row} className="mb-3 rounded-xl border border-neutral-100 p-3 last:mb-0">
                  <div className="h-3 w-4/5 rounded bg-neutral-200" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-neutral-100" />
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <>
          <div className="mb-5 grid gap-3 md:grid-cols-3">
            {Array.from({ length: variant === "detail" ? 3 : 4 }, (_, index) => (
              <div key={index} className="h-24 rounded-xl border border-neutral-100 bg-neutral-50" />
            ))}
          </div>
          <div className="vq-card-static rounded-xl bg-white p-4">
            {Array.from({ length: rows }, (_, row) => (
              <div key={row} className="flex items-center gap-4 border-b border-neutral-100 py-4 last:border-0">
                <div className="h-8 w-8 rounded-lg bg-neutral-100" />
                <div className="flex-1">
                  <div className="h-3 w-2/5 rounded bg-neutral-200" />
                  <div className="mt-2 h-3 w-1/4 rounded bg-neutral-100" />
                </div>
                <div className="h-7 w-20 rounded bg-neutral-100" />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}