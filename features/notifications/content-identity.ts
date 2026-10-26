import "server-only";
import { hashSecret } from "@/features/bookings/capabilities";

export function notificationContentIdentity(booking: {
  id: string;
  startAt: Date | string;
  endAt: Date | string;
  serviceName: string;
  servicePriceUsd: string;
  serviceDurationMinutes: number;
  barberName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
}) {
  return hashSecret(
    JSON.stringify({
      id: booking.id,
      startAt: new Date(booking.startAt).toISOString(),
      endAt: new Date(booking.endAt).toISOString(),
      serviceName: booking.serviceName,
      servicePriceUsd: booking.servicePriceUsd,
      serviceDurationMinutes: booking.serviceDurationMinutes,
      barberName: booking.barberName,
      customerName: booking.customerName,
      customerEmail: booking.customerEmail,
      customerPhone: booking.customerPhone,
    }),
  );
}
