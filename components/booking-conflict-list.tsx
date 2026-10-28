import type { BookingConflict } from "@/lib/action-result";

export function BookingConflictList({
  conflicts,
}: {
  conflicts: BookingConflict[];
}) {
  if (!conflicts.length) return null;
  return (
    <section
      aria-label="Appointments to resolve"
      className="rounded-lg border p-3"
    >
      <h3 className="font-semibold">
        Resolve these {conflicts.length} appointment
        {conflicts.length === 1 ? "" : "s"} before retrying
      </h3>
      <ul className="mt-2 grid gap-2 text-sm">
        {conflicts.map((booking) => (
          <li key={booking.bookingId} className="rounded-md bg-muted/50 p-2">
            <p className="font-medium">
              {booking.customerName} · {booking.serviceName} with{" "}
              {booking.barberName}
            </p>
            <p className="text-muted-foreground">
              {new Date(booking.startAt).toISOString()} –{" "}
              {new Date(booking.endAt).toISOString()} (UTC)
            </p>
            <a
              className="mt-1 inline-block underline underline-offset-4"
              href={`/appointments/${booking.bookingId}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open appointment details for {booking.customerName} (opens in a
              new tab)
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
