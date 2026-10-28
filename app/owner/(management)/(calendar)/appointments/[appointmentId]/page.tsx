import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Temporal } from "temporal-polyfill";
import {
  AppointmentDetails,
  AppointmentOperationsReadError,
} from "@/features/bookings/components/appointment-details";
import {
  AppointmentCalendarBackLink,
  AppointmentOperations,
} from "@/features/bookings/components/appointment-operations";
import {
  getOwnAppointment,
  getOwnAppointmentMoveChoices,
} from "@/features/bookings/queries";
import { readOwnerContext } from "@/server/owner-context";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function AppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ appointmentId: string }>;
  searchParams: Search;
}) {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-background" />}>
      <AppointmentContent params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function AppointmentContent({
  params,
  searchParams,
}: {
  params: Promise<{ appointmentId: string }>;
  searchParams: Search;
}) {
  const context = await readOwnerContext(await headers());
  if (!context) redirect("/sign-in");
  const { appointmentId } = await params;
  const result = await getOwnAppointment(context, appointmentId);
  if (!result.success) {
    if (result.error.code === "SHOP_REQUIRED") redirect("/setup");
    if (result.error.code === "UNAUTHENTICATED") redirect("/sign-in");
    if (result.error.code === "NOT_FOUND") notFound();
    return (
      <main className="m-auto max-w-xl p-8" role="alert">
        <h1>Appointment unavailable</h1>
        <p>{result.error.message}</p>
        <a
          className="mt-4 inline-block underline"
          href={`/appointments/${appointmentId}`}
        >
          Try again
        </a>
      </main>
    );
  }
  const search = await searchParams;
  const date =
    typeof search.date === "string" && validDate(search.date)
      ? search.date
      : "";
  const view = search.view === "week" ? "week" : "day";
  const barber =
    typeof search.barber === "string"
      ? `&barber=${encodeURIComponent(search.barber)}`
      : "";
  const calendarHref = date ? `/?date=${date}&view=${view}${barber}` : "/";
  const retryHref = date
    ? `/appointments/${appointmentId}?date=${date}&view=${view}${barber}`
    : `/appointments/${appointmentId}`;
  const moveChoices = await getOwnAppointmentMoveChoices(
    context,
    appointmentId,
  );
  return (
    <main className="mx-auto my-8 w-full max-w-3xl flex-1 rounded-3xl border border-border bg-background p-6 max-[520px]:my-0 max-[520px]:rounded-none max-[520px]:border-0 max-[520px]:px-5">
      <div className="mb-5 flex justify-end">
        <AppointmentCalendarBackLink href={calendarHref} />
      </div>
      <AppointmentDetails
        appointment={result.data}
        now={new Date().toISOString()}
        operations={
          moveChoices.success ? (
            <AppointmentOperations
              appointment={result.data}
              choices={moveChoices.data}
              now={new Date().toISOString()}
            />
          ) : (
            <AppointmentOperationsReadError href={retryHref} />
          )
        }
      />
    </main>
  );
}

function validDate(value: string) {
  try {
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Temporal.PlainDate.from(value).toString() === value
    );
  } catch {
    return false;
  }
}
