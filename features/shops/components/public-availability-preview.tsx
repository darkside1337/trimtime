"use client";

import { useState } from "react";

type Service = {
  id: string;
  name: string;
  barbers: { id: string; name: string }[];
};

export function PublicAvailabilityPreview({
  services,
  initialServiceId,
  initialBarberId,
  date,
}: {
  services: Service[];
  initialServiceId: string | undefined;
  initialBarberId: string | undefined;
  date: string;
}) {
  const [serviceId, setServiceId] = useState(initialServiceId ?? "");
  const barbers =
    services.find((service) => service.id === serviceId)?.barbers ?? [];
  const [barberId, setBarberId] = useState(initialBarberId ?? "");

  return (
    <form
      method="get"
      className="grid gap-4 rounded-xl bg-muted p-5 sm:grid-cols-3 sm:items-end"
    >
      <label className="grid gap-2 text-sm font-medium">
        Service
        <select
          name="serviceId"
          value={serviceId}
          onChange={(event) => {
            const nextServiceId = event.currentTarget.value;
            setServiceId(nextServiceId);
            setBarberId(
              services.find((service) => service.id === nextServiceId)
                ?.barbers[0]?.id ?? "",
            );
          }}
          className="h-10 rounded-md border bg-background px-3"
        >
          {services.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Barber
        <select
          name="barberId"
          value={barberId}
          onChange={(event) => setBarberId(event.currentTarget.value)}
          disabled={!barbers.length}
          className="h-10 rounded-md border bg-background px-3"
        >
          {barbers.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm font-medium">
        Date
        <input
          name="date"
          type="date"
          defaultValue={date}
          className="h-10 rounded-md border bg-background px-3"
        />
      </label>
      <button
        className="h-10 rounded-md bg-primary px-4 text-primary-foreground sm:col-span-3 sm:justify-self-end"
        type="submit"
      >
        Preview starts
      </button>
    </form>
  );
}
