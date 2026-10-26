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
    email: string;
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
