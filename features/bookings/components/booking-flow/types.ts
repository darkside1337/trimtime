export type BookingService = {
  id: string;
  name: string;
  priceUsd: string;
  durationMinutes: string;
  barbers: { id: string; name: string }[];
};

export type BookingSlot = {
  start: string;
  localStart: string;
  offset: string;
};

export type BookingContact = {
  name: string;
  email: string;
  phone: string;
  whatsappOptIn: boolean;
};
