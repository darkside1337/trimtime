import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { Temporal } from "temporal-polyfill";
import {
  AppointmentDialog,
  AppointmentDialogError,
} from "@/features/bookings/components/appointment-dialog";
import {
  getOwnAppointment,
  getOwnAppointmentMoveChoices,
} from "@/features/bookings/queries";
import { readOwnerContext } from "@/server/owner-context";

type Search = Promise<Record<string, string | string[] | undefined>>;

export default function InterceptedAppointmentPage({
  params,
  searchParams,
}: {
  params: Promise<{ appointmentId: string }>;
  searchParams: Search;
}) {
  return (
    <Suspense
      fallback={
        <div
          className="fixed inset-0 z-50 bg-black/30"
          aria-label="Loading appointment details"
        />
      }
    >
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
    return <AppointmentDialogError message={result.error.message} />;
  }
  const moveChoices = await getOwnAppointmentMoveChoices(
    context,
    appointmentId,
  );
  if (!moveChoices.success)
    return (
      <AppointmentDialogError message="Appointment actions could not be loaded. Try again." />
    );
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
  return (
    <AppointmentDialog
      appointment={result.data}
      calendarHref={calendarHref}
      now={new Date().toISOString()}
      moveChoices={moveChoices.data}
    />
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
