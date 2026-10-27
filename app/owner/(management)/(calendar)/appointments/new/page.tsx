import { Suspense } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Temporal } from "temporal-polyfill";
import { AppointmentForm } from "@/features/bookings/components/appointment-form";
import { getOwnAppointmentChoices } from "@/features/bookings/queries";
import { readOwnerContext } from "@/server/owner-context";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function NewAppointmentPage({
  searchParams,
}: {
  searchParams: Search;
}) {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-background" />}>
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
      <main className="m-auto max-w-xl p-8" role="alert">
        <h1>Appointments unavailable</h1>
        <p>{result.error.message}</p>
        <a href="/appointments/new">Try again</a>
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
    <AppointmentForm
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
