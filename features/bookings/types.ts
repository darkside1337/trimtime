import type { CustomerEmailSummary } from "@/features/notifications/customer-summary";

export type PublicBookingContext = {
  shopId: string;
};

export type PublicBookingInput = {
  serviceId: string;
  barberId: string;
  startAt: string;
  reviewedOffer: { name: string; priceUsd: string; durationMinutes: string };
  contact: {
    name: string;
    email: string;
    phone?: string;
    whatsappOptIn: boolean;
  };
  recoveryKey: string;
};

export type BookingFailureCode =
  | "VALIDATION_ERROR"
  | "STALE_OFFER"
  | "UNAVAILABLE_INTERVAL"
  | "SHOP_PAUSED"
  | "RATE_LIMITED"
  | "RECOVERY_MISMATCH"
  | "UNAVAILABLE";

export type ManagedBookingView = {
  notifications: { email: CustomerEmailSummary };
  status: "confirmed" | "cancelled";
  startAt: string;
  endAt: string;
  service: { name: string; priceUsd: string; durationMinutes: number };
  barber: { name: string };
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    whatsappOptIn: boolean;
  };
  shop: {
    name: string;
    publicContact: string;
    address: string;
    timeZone: string;
  };
  past: boolean;
  changeCutoffPassed: boolean;
};

export type PublicBookingReceipt = {
  bookingId: string;
  manageUrl: string;
  booking: ManagedBookingView;
  notifications: {
    email: CustomerEmailSummary;
    whatsapp: "unavailable";
  };
};

export type OwnerCalendarAppointment = {
  id: string;
  status: "confirmed" | "cancelled";
  startAt: string;
  endAt: string;
  service: { name: string; priceUsd: string; durationMinutes: number };
  barber: { id: string; name: string; archived: boolean };
  customer: { name: string };
};

export type OwnerCalendarView = {
  timeZone: string;
  range: { startAt: string; endAt: string };
  barbers: { id: string; name: string; archived: boolean }[];
  appointments: OwnerCalendarAppointment[];
};

export type OwnerAppointmentView = {
  id: string;
  status: "confirmed" | "cancelled";
  startAt: string;
  endAt: string;
  service: { name: string; priceUsd: string; durationMinutes: number };
  barber: { id: string; name: string; archived: boolean };
  customer: {
    name: string;
    email: string | null;
    phone: string | null;
    whatsappOptIn: boolean;
  };
  shop: {
    name: string;
    publicContact: string;
    address: string;
    timeZone: string;
  };
  notifications: { email: CustomerEmailSummary };
};

export type OwnerAppointmentChoices = {
  timeZone: string;
  barbers: { id: string; name: string }[];
  services: {
    id: string;
    name: string;
    priceUsd: string;
    durationMinutes: number;
    barberIds: string[];
  }[];
};

export type OwnerBookingReceipt = {
  bookingId: string;
  appointment: OwnerAppointmentView;
  notifications: {
    email: CustomerEmailSummary;
    whatsapp: "unavailable" | "not_requested";
  };
};
