import { Suspense } from "react";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Temporal } from "temporal-polyfill";
import { AppointmentEntryDialog } from "@/features/bookings/components/appointment-entry-dialog";
import { AppointmentLoading } from "@/features/bookings/components/appointment-loading";
import { getOwnAppointmentChoices } from "@/features/bookings/queries";
import { readOwnerContext } from "@/server/owner-context";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function InterceptedNewAppointmentPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  return (
    <Suspense fallback={<AppointmentLoading />}>
      <AppointmentEntry searchParams={searchParams} />
    </Suspense>
  );
}

async function AppointmentEntry({ searchParams }: { searchParams: Search }) {
  const context = await readOwnerContext(await headers());
  if (!context) redirect("/sign-in");
  const result = await getOwnAppointmentChoices(context);
  if (!result.success) {
    if (result.error.code === "SHOP_REQUIRED") redirect("/setup");
    return (
      <main
        role="alert"
        className="fixed inset-0 z-50 grid place-items-center bg-black/30 p-4"
      >
        <section className="w-full max-w-lg rounded-3xl border border-border bg-background p-6 shadow-xl">
          <h1 className="text-lg font-semibold">
            Appointment details unavailable
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {result.error.message} Your calendar and current filters are saved.
          </p>
          <div className="mt-5 flex justify-end gap-3">
            <Link
              className="inline-flex min-h-11 items-center rounded-xl border border-border px-4 text-sm font-semibold"
              href="/"
            >
              Return to calendar
            </Link>
            <Link
              className="inline-flex min-h-11 items-center rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground"
              href="/appointments/new"
            >
              Try again
            </Link>
          </div>
        </section>
      </main>
    );
  }
  const search = await searchParams;
  const date = getDate(search.date, result.data.timeZone);
  const barber =
    typeof search.barber === "string" &&
    result.data.barbers.some((candidate) => candidate.id === search.barber)
      ? search.barber
      : "";
  const time =
    typeof search.time === "string" &&
    /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(search.time)
      ? search.time
      : "";
  const returnDate = getDate(search.returnDate, result.data.timeZone);
  const returnView = search.returnView === "week" ? "week" : "day";
  const returnBarber =
    typeof search.returnBarber === "string" &&
    result.data.barbers.some(
      (candidate) => candidate.id === search.returnBarber,
    )
      ? search.returnBarber
      : "";
  const calendarHref = `/?date=${returnDate}&view=${returnView}${returnBarber ? `&barber=${encodeURIComponent(returnBarber)}` : ""}`;
  return (
    <AppointmentEntryDialog
      choices={result.data}
      initialDate={date}
      initialTime={time}
      initialBarberId={barber}
      calendarHref={calendarHref}
    />
  );
}

function getDate(value: string | string[] | undefined, timeZone: string) {
  if (typeof value === "string") {
    try {
      return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Temporal.PlainDate.from(value).toString() === value
        ? value
        : today(timeZone);
    } catch {
      return today(timeZone);
    }
  }
  return today(timeZone);
}

function today(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}-${parts.find((part) => part.type === "day")!.value}`;
}
