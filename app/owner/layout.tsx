import type { ReactNode } from "react";
import { OwnerAppointmentProvider } from "@/features/bookings/components/owner-calendar-context";

export default function OwnerLayout({
  children,
  appointment,
}: {
  children: ReactNode;
  appointment: ReactNode;
}) {
  return (
    <OwnerAppointmentProvider>
      {children}
      {appointment}
    </OwnerAppointmentProvider>
  );
}
