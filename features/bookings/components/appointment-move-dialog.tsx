"use client";

import type { FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { OwnerAppointmentMoveChoices } from "../types";
import type { OwnerAppointmentDraftValues } from "./owner-calendar-context";

type Values = OwnerAppointmentDraftValues;
type MoveService = OwnerAppointmentMoveChoices["services"][number];
type MoveBarber = OwnerAppointmentMoveChoices["barbers"][number];
type StartChoice = { startAt: string; offset: string };

export function AppointmentMoveDialogContent({
  choices,
  values,
  service,
  barbers,
  starts,
  dirty,
  busy,
  error,
  uncertain,
  onUpdate,
  onSubmit,
  onRetry,
  onReloadSaved,
  onReviewCurrentOffer,
}: {
  choices: OwnerAppointmentMoveChoices;
  values: Values;
  service: MoveService | undefined;
  barbers: MoveBarber[];
  starts: StartChoice[];
  dirty: boolean;
  busy: boolean;
  error: string;
  uncertain: boolean;
  onUpdate: (patch: Partial<Values>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRetry: () => void;
  onReloadSaved: () => void;
  onReviewCurrentOffer: () => void;
}) {
  return (
    <>
      <DialogTitle>Move appointment</DialogTitle>
      <DialogDescription>
        Review the service, barber and exact local start time. The saved
        appointment stays in place if the new time is unavailable.
      </DialogDescription>
      {error && (
        <p role="alert" tabIndex={-1}>
          {error}
        </p>
      )}
      {error && /changed|current service/i.test(error) && (
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            if (/Appointment changed/i.test(error)) onReloadSaved();
            else onReviewCurrentOffer();
          }}
        >
          Reload saved appointment and review
        </Button>
      )}
      {uncertain ? (
        <Button type="button" disabled={busy} onClick={onRetry}>
          {busy ? "Recovering…" : "Retry same operation"}
        </Button>
      ) : (
        <form onSubmit={onSubmit} className="grid gap-4">
          <label className="grid gap-1 text-sm">
            Service
            <select
              aria-label="Service"
              value={values.serviceId}
              disabled={busy}
              onChange={(event) => onUpdate({ serviceId: event.target.value })}
              className="min-h-11 rounded-xl border border-border bg-background px-3"
            >
              {choices.services.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name} · ${item.priceUsd}
                  {item.hidden ? " · saved service, no longer offered" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Barber
            <select
              aria-label="Barber"
              value={values.barberId}
              disabled={busy || !barbers.length}
              onChange={(event) => onUpdate({ barberId: event.target.value })}
              className="min-h-11 rounded-xl border border-border bg-background px-3"
            >
              <option value="">Choose a barber…</option>
              {barbers.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            Date
            <input
              aria-label="Date"
              type="date"
              required
              value={values.date}
              disabled={busy}
              onChange={(event) =>
                onUpdate({ date: event.target.value, occurrence: "" })
              }
              className="min-h-11 rounded-xl border border-border bg-background px-3"
            />
          </label>
          <label className="grid gap-1 text-sm">
            Start time
            <input
              aria-label="Start time"
              type="time"
              required
              value={values.time}
              disabled={busy}
              onChange={(event) =>
                onUpdate({ time: event.target.value, occurrence: "" })
              }
              className="min-h-11 rounded-xl border border-border bg-background px-3"
            />
          </label>
          {starts.length > 1 && (
            <label className="grid gap-1 text-sm">
              Time occurrence
              <select
                aria-label="Time occurrence"
                required
                value={values.occurrence}
                onChange={(event) =>
                  onUpdate({ occurrence: event.target.value })
                }
              >
                <option value="">Choose an occurrence…</option>
                {starts.map((item) => (
                  <option key={item.startAt} value={item.startAt}>
                    {item.offset} · {item.startAt}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-xs text-muted-foreground">
            {service
              ? `${service.durationMinutes} minutes · $${service.priceUsd} USD · ${choices.timeZone}`
              : `Select a service · ${choices.timeZone}`}
          </p>
          <Button type="submit" disabled={busy || !dirty}>
            {busy ? "Saving…" : "Save move"}
          </Button>
        </form>
      )}
    </>
  );
}
