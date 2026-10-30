import { Suspense } from "react";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import {
  AppointmentDialog,
  AppointmentDialogError,
} from "@/features/bookings/components/appointment-dialog";
import {
  getOwnAppointment,
  getOwnAppointmentMoveChoices,
} from "@/features/bookings/queries";
import { readOwnerContext } from "@/server/owner-context";

export default function InterceptedAppointmentPage({
  params,
}: {
  params: Promise<{ appointmentId: string }>;
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
      <AppointmentContent params={params} />
    </Suspense>
  );
}

async function AppointmentContent({
  params,
}: {
  params: Promise<{ appointmentId: string }>;
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
  return (
    <AppointmentDialog
      appointment={result.data}
      now={new Date().toISOString()}
      moveChoices={moveChoices.data}
    />
  );
}
