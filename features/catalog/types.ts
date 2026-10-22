export type ServiceInput = {
  id?: string;
  name: string;
  priceUsd: string;
  durationMinutes: string;
  offered: boolean;
  barberIds: string[];
};

export type BarberInput = { id?: string; name: string; serviceIds: string[] };

export type ServiceView = ServiceInput & { id: string; archived: boolean };

export type BarberView = {
  id: string;
  name: string;
  archived: boolean;
  serviceIds: string[];
};
