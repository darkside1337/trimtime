"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { previewOwnSlotsAction } from "../actions";
import type { AvailabilityData } from "../queries";
import type { Slot } from "../types";

export function SlotPreviewPanel({
  data,
  hidden = false,
  invalidationKey,
  disabled = false,
}: {
  data: AvailabilityData;
  hidden?: boolean;
  invalidationKey: number;
  disabled?: boolean;
}) {
  const [serviceId, setServiceId] = useState("");
  const [barberId, setBarberId] = useState("");
  const [date, setDate] = useState("");
  const [previewState, setPreviewState] = useState<{
    data: AvailabilityData;
    hidden: boolean;
    invalidationKey: number;
    serviceId: string;
    barberId: string;
    date: string;
    slots: Slot[] | null;
    message: string;
    pending: boolean;
  } | null>(null);
  const previewVersion = useRef(0);
  const currentPreview =
    previewState?.data === data &&
    previewState.hidden === hidden &&
    previewState.invalidationKey === invalidationKey &&
    previewState.serviceId === serviceId &&
    previewState.barberId === barberId &&
    previewState.date === date
      ? previewState
      : null;
  const activeBarbers = data.barbers.filter((item) => !item.archived);
  const services = data.services.filter((service) =>
    service.barberIds.some((id) =>
      activeBarbers.some((item) => item.id === id),
    ),
  );
  const eligibleBarbers = useMemo(
    () =>
      data.barbers.filter(
        (item) =>
          !item.archived &&
          item.schedule &&
          (!serviceId ||
            data.services
              .find((service) => service.id === serviceId)
              ?.barberIds.includes(item.id)),
      ),
    [data, serviceId],
  );

  function invalidate() {
    previewVersion.current++;
    setPreviewState(null);
  }

  useEffect(() => {
    previewVersion.current++;
    // Props changes invalidate both visible results and requests still in flight.
  }, [data, hidden, invalidationKey]);

  async function preview() {
    const version = ++previewVersion.current;
    const context = {
      data,
      hidden,
      invalidationKey,
      serviceId,
      barberId,
      date,
    };
    const update = (value: {
      slots?: Slot[] | null;
      message?: string;
      pending?: boolean;
    }) =>
      setPreviewState({
        ...context,
        ...value,
        slots: value.slots ?? null,
        message: value.message ?? "",
        pending: value.pending ?? false,
      });
    update({ pending: true });
    try {
      const result = await previewOwnSlotsAction({ serviceId, barberId, date });
      if (version !== previewVersion.current) return;
      if (result.success) {
        update({
          slots: result.data.slots,
          message: `Showing saved availability for ${result.data.date} in ${result.data.timeZone}.`,
          pending: false,
        });
      } else update({ message: result.error.message, pending: false });
    } catch {
      if (version === previewVersion.current)
        update({
          message: "Unable to load a preview. Try again.",
          pending: false,
        });
    }
  }

  function handleServiceChange(event: ChangeEvent<HTMLSelectElement>) {
    invalidate();
    setServiceId(event.target.value);
    setBarberId("");
  }

  function handleBarberChange(event: ChangeEvent<HTMLSelectElement>) {
    invalidate();
    setBarberId(event.target.value);
  }

  function handleDateChange(event: ChangeEvent<HTMLInputElement>) {
    invalidate();
    setDate(event.target.value);
  }

  return (
    <section
      hidden={hidden}
      aria-labelledby="preview-heading"
      className="rounded-2xl border border-border bg-muted/40 p-5 sm:p-8"
    >
      <h2 id="preview-heading" className="font-heading text-2xl font-bold">
        Preview available starts
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Previews use saved schedules and current service settings. Save schedule
        edits before previewing; a preview does not reserve a time.
      </p>
      <p className="mt-2 text-sm font-medium">
        Shop time zone: {data.timeZone}
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-3">
        <div className="grid gap-2">
          <Label htmlFor="preview-service">Service</Label>
          <select
            id="preview-service"
            className="min-h-11 rounded-md border border-input bg-background px-3"
            value={serviceId}
            onChange={handleServiceChange}
            disabled={disabled}
          >
            <option value="">Choose a service</option>
            {services.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.durationMinutes} min
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="preview-barber">Eligible barber</Label>
          <select
            id="preview-barber"
            className="min-h-11 rounded-md border border-input bg-background px-3"
            value={barberId}
            onChange={handleBarberChange}
            disabled={disabled}
          >
            <option value="">Choose a barber</option>
            {eligibleBarbers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="preview-date">Date</Label>
          <Input
            id="preview-date"
            type="date"
            value={date}
            onChange={handleDateChange}
            disabled={disabled}
          />
        </div>
      </div>
      {services.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">
          Offer a service and assign it to an active barber to preview times.
        </p>
      )}
      <Button
        type="button"
        className="mt-5"
        disabled={
          disabled ||
          currentPreview?.pending ||
          !serviceId ||
          !barberId ||
          !date
        }
        onClick={preview}
      >
        Preview times
      </Button>
      {currentPreview?.slots !== null &&
        currentPreview?.slots !== undefined && (
          <div className="mt-5" aria-live="polite">
            <h3 className="font-semibold">Available starts</h3>
            {currentPreview.slots.length ? (
              <ul className="mt-3 flex flex-wrap gap-2">
                {currentPreview.slots.map((slot) => (
                  <li
                    key={slot.start}
                    className="rounded-full border bg-background px-3 py-2 text-sm tabular-nums"
                  >
                    {slot.localStart} · UTC{slot.offset}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                No available starts match these saved schedules and public
                booking windows.
              </p>
            )}
          </div>
        )}
      {currentPreview?.message && (
        <p aria-live="polite" aria-atomic="true" className="mt-3 text-sm">
          {currentPreview.message}
        </p>
      )}
    </section>
  );
}
