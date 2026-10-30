"use client";

import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { OwnerAppointmentView } from "../types";

function dateTime(
  instant: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(
    new Date(instant),
  );
}

export function AppointmentRestoreDialogContent({
  appointment,
  busy,
  error,
  uncertain,
  onRetry,
  onKeep,
  onConfirm,
}: {
  appointment: OwnerAppointmentView;
  busy: boolean;
  error: string;
  uncertain: boolean;
  onRetry: () => void;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const { timeZone } = appointment.shop;
  return (
    <>
      <DialogTitle className="max-w-full pr-8">
        Restore appointment?
      </DialogTitle>
      <DialogDescription>
        This restores the saved interval and details below. We will recheck
        availability before reserving this time.
      </DialogDescription>
      {(error || uncertain) && (
        <p role="alert" tabIndex={-1}>
          {error ||
            "The response was interrupted. Retry the same operation to recover its result."}
        </p>
      )}
      <dl className="grid gap-2 rounded-xl bg-muted px-4 py-3 text-sm">
        <div>
          <dt className="text-[11px] text-muted-foreground">Service</dt>
          <dd className="font-semibold">
            {appointment.service.name} · {appointment.service.durationMinutes}{" "}
            min · ${appointment.service.priceUsd} USD
          </dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">Barber</dt>
          <dd className="font-semibold">{appointment.barber.name}</dd>
        </div>
        <div>
          <dt className="text-[11px] text-muted-foreground">
            Saved time · {timeZone}
          </dt>
          <dd className="font-semibold">
            {dateTime(appointment.startAt, timeZone, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}{" "}
            ·{" "}
            {dateTime(appointment.startAt, timeZone, {
              hour: "2-digit",
              minute: "2-digit",
            })}
            –
            {dateTime(appointment.endAt, timeZone, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        {uncertain ? (
          <Button type="button" disabled={busy} onClick={onRetry}>
            {busy ? "Recovering…" : "Retry same operation"}
          </Button>
        ) : (
          <>
            <Button variant="outline" disabled={busy} onClick={onKeep}>
              Keep cancelled
            </Button>
            <Button disabled={busy} onClick={onConfirm}>
              {busy ? "Restoring…" : "Restore appointment"}
            </Button>
          </>
        )}
      </div>
    </>
  );
}
