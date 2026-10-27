export function AppointmentLoading() {
  return (
    <div
      role="status"
      aria-label="Loading appointment form"
      className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
    >
      <div className="w-full max-w-[680px] animate-pulse rounded-3xl bg-background p-8 shadow-xl">
        <div className="h-6 w-48 rounded bg-muted" />
        <div className="mt-6 grid gap-4">
          <div className="h-12 rounded-xl bg-muted" />
          <div className="h-12 rounded-xl bg-muted" />
          <div className="h-12 rounded-xl bg-muted" />
        </div>
      </div>
    </div>
  );
}
