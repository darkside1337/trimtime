import type { OwnerAppointmentView } from "../types";
import { ownerEmailStatusCopy } from "@/features/notifications/customer-summary";
import type { ReactNode } from "react";

function dateTime(
  instant: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(
    new Date(instant),
  );
}

export function AppointmentDetails({
  appointment,
  now,
  operations,
}: {
  appointment: OwnerAppointmentView;
  now: string;
  operations?: ReactNode;
}) {
  const past = Date.parse(appointment.endAt) <= Date.parse(now);
  const status =
    appointment.status === "cancelled"
      ? "Cancelled"
      : past
        ? "Past, unmarked"
        : "Confirmed";
  const email = appointment.customer.email
    ? appointment.customer.email
    : "No email provided";
  return (
    <div className="grid gap-5">
      <header className="border-b border-border pb-4">
        <p className="text-[11px] font-bold uppercase tracking-[.1em] text-[var(--success)]">
          Owner appointment
        </p>
        <h1 className="font-heading text-2xl">Appointment details</h1>
        <p className="text-sm text-muted-foreground">
          {dateTime(appointment.startAt, appointment.shop.timeZone, {
            weekday: "long",
            day: "numeric",
            month: "long",
          })}{" "}
          ·{" "}
          {dateTime(appointment.startAt, appointment.shop.timeZone, {
            hour: "2-digit",
            minute: "2-digit",
          })}
          –
          {dateTime(appointment.endAt, appointment.shop.timeZone, {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </header>
      <p className="w-fit rounded-full bg-secondary px-3 py-1 text-xs font-semibold">
        {status}
      </p>
      <dl className="grid grid-cols-2 gap-2.5 max-[520px]:grid-cols-1">
        <Detail label="Customer" value={appointment.customer.name} />
        <Detail label="Email" value={email} />
        <Detail
          label="Phone"
          value={appointment.customer.phone ?? "No phone provided"}
        />
        <Detail
          label="WhatsApp consent"
          value={appointment.customer.whatsappOptIn ? "Yes" : "No"}
        />
        <Detail
          label="Recorded service"
          value={`${appointment.service.name} · ${appointment.service.durationMinutes} min · $${appointment.service.priceUsd} USD`}
        />
        <Detail label="Barber" value={appointment.barber.name} />
        <div className="col-span-full rounded-xl bg-muted px-4 py-3 max-[520px]:col-span-auto">
          <dt className="text-[11px] text-muted-foreground">
            Scheduled time · {appointment.shop.timeZone}
          </dt>
          <dd className="mt-1 text-sm font-semibold">
            {dateTime(appointment.startAt, appointment.shop.timeZone, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}{" "}
            ·{" "}
            {dateTime(appointment.startAt, appointment.shop.timeZone, {
              hour: "2-digit",
              minute: "2-digit",
            })}
            –
            {dateTime(appointment.endAt, appointment.shop.timeZone, {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </dd>
        </div>
      </dl>
      <section
        className="rounded-xl border border-border bg-secondary/60 px-4 py-3"
        aria-label="Email notification status"
      >
        <h2 className="text-sm font-semibold">Customer email status</h2>
        <p className="mt-1 text-sm">
          {appointment.customer.email
            ? ownerEmailStatusCopy(appointment.notifications.email)
            : "No customer email was sent."}
        </p>
      </section>
      {appointment.customer.phone && (
        <section className="rounded-xl border border-border px-4 py-3">
          <h2 className="text-sm font-semibold">
            WhatsApp ·{" "}
            {appointment.customer.whatsappOptIn
              ? "Unavailable"
              : "Not requested"}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {appointment.customer.whatsappOptIn
              ? "WhatsApp delivery is not available."
              : "The customer did not opt in to WhatsApp messages."}
          </p>
        </section>
      )}
      {operations}
    </div>
  );
}

export function AppointmentOperationsReadError({ href }: { href: string }) {
  return (
    <section
      className="rounded-xl border border-destructive/40 px-4 py-3"
      role="alert"
    >
      <p className="text-sm">Appointment actions could not be loaded.</p>
      <a
        className="mt-2 inline-block text-sm font-semibold underline"
        href={href}
      >
        Try again
      </a>
    </section>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-xl bg-muted px-4 py-3">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-semibold">{value}</dd>
    </div>
  );
}
