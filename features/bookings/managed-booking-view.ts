import type { BookingStatus, ManagedBookingView } from "./types";
import { isCustomerChangeCutoffPassed } from "./customer-primitives";

export type ManagedBookingViewRow = {
  revision: number;
  status: BookingStatus;
  startAt: Date | string;
  endAt: Date | string;
  serviceName: string;
  servicePriceUsd: string;
  serviceDurationMinutes: number;
  barberName: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone: string | null;
  whatsappOptIn: boolean;
  shopName: string;
  publicContact: string;
  address: string;
  timeZone: string;
  notifications: ManagedBookingView["notifications"];
};

/**
 * Projects an authorized booking row into the customer-visible view. Callers
 * keep query scoping and the `now` sample; this function only applies the
 * shared status, cutoff, and presentation rules.
 */
export function toManagedBookingView(
  row: ManagedBookingViewRow,
  now: Date,
): ManagedBookingView {
  const startAt = new Date(row.startAt);
  const endAt = new Date(row.endAt);
  return {
    revision: row.revision,
    status: row.status,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    service: {
      name: row.serviceName,
      priceUsd: row.servicePriceUsd,
      durationMinutes: row.serviceDurationMinutes,
    },
    barber: { name: row.barberName },
    customer: {
      name: row.customerName,
      email: row.customerEmail,
      phone: row.customerPhone,
      whatsappOptIn: row.whatsappOptIn,
    },
    shop: {
      name: row.shopName,
      publicContact: row.publicContact,
      address: row.address,
      timeZone: row.timeZone,
    },
    notifications: row.notifications,
    past: endAt.getTime() <= now.getTime(),
    changeCutoffPassed:
      row.status !== "confirmed" || isCustomerChangeCutoffPassed(startAt, now),
  };
}
