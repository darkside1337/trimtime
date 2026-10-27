import Link from "next/link";
import { Button, buttonVariants } from "@/components/ui/button";
import type { OwnerCalendarView } from "../types";
import { AppointmentLinkLoading } from "./appointment-link-loading";

type Props = {
  calendar: OwnerCalendarView;
  shopName: string;
  published: boolean;
  date: string;
  view: "day" | "week";
  now: string;
  barberId?: string;
  created?: { id: string; customerName: string; emailCopy: string };
};

function day(
  value: string,
  _timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    ...options,
  }).format(new Date(`${value}T12:00:00Z`));
}

function dateFor(
  instant: string,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, ...options }).format(
    new Date(instant),
  );
}

function addDays(date: string, amount: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function monday(date: string) {
  const value = new Date(`${date}T12:00:00Z`);
  return addDays(date, -((value.getUTCDay() + 6) % 7));
}

function params(date: string, view: "day" | "week", barberId?: string) {
  const search = new URLSearchParams({ date, view });
  if (barberId) search.set("barber", barberId);
  return `/?${search.toString()}`;
}

function newAppointmentHref(
  calendarDate: string,
  view: "day" | "week",
  barberId: string | undefined,
  slotDate = calendarDate,
  time?: string,
) {
  const search = new URLSearchParams({
    date: slotDate,
    view,
    barber: barberId ?? "all",
    returnDate: calendarDate,
    returnView: view,
    returnBarber: barberId ?? "all",
  });
  if (time) search.set("time", time);
  return `/appointments/new?${search.toString()}`;
}

export function OwnerCalendar({
  calendar,
  shopName,
  published,
  date,
  view,
  barberId,
  created,
  now,
}: Props) {
  const start = view === "week" ? monday(date) : date;
  const days =
    view === "week"
      ? Array.from({ length: 7 }, (_, index) => addDays(start, index))
      : [date];
  const periodLabel =
    view === "day"
      ? day(date, calendar.timeZone, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : `${day(start, calendar.timeZone, { day: "numeric", month: "short" })}–${day(addDays(start, 6), calendar.timeZone, { day: "numeric", month: "short", year: "numeric" })}`;
  const rangeStep = view === "day" ? 1 : 7;

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-[1480px] flex-[1_0_auto] flex-col gap-4 px-7 py-6 max-[640px]:px-4 max-[640px]:py-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[.1em] text-[var(--success)]">
            {shopName} · owner workspace
          </p>
          <h1 className="font-heading text-[34px] font-medium leading-tight tracking-[-.04em] max-[640px]:text-[28px]">
            Calendar
          </h1>
          <p className="text-[13px] text-muted-foreground">
            Shop time zone: {calendar.timeZone}
          </p>
        </div>
        <Link
          className={buttonVariants({
            className: "min-h-11 rounded-full px-[18px]",
          })}
          data-slot="button"
          data-size="default"
          data-variant="default"
          href={newAppointmentHref(date, view, barberId)}
        >
          New appointment
          <AppointmentLinkLoading />
        </Link>
      </header>
      <div
        className="flex items-center justify-between gap-4 rounded-2xl bg-secondary px-4 py-3 max-[640px]:flex-col max-[640px]:items-start"
        role="status"
      >
        <div>
          <strong>{published ? "Shop published" : "Shop unpublished"}</strong>
          <p className="text-[13px]">
            {published
              ? "Your public shop page is available. This calendar shows saved appointments."
              : "Your schedule stays available while you finish setup. Public booking remains off."}
          </p>
        </div>
        {!published && (
          <Link
            href="/settings"
            className="text-[13px] font-bold hover:underline"
          >
            Review setup
          </Link>
        )}
      </div>
      {created && (
        <p
          className="rounded-xl border border-border bg-secondary px-4 py-3 text-sm"
          role="status"
        >
          Appointment saved for {created.customerName}. {created.emailCopy}{" "}
          <Link
            className="font-semibold underline"
            href={`/appointments/${created.id}?date=${date}&view=${view}${barberId ? `&barber=${barberId}` : ""}`}
          >
            View details
          </Link>
        </p>
      )}
      <div
        className="flex flex-wrap items-center justify-between gap-3 max-[640px]:items-stretch"
        aria-label="Calendar controls"
      >
        <div className="flex flex-wrap items-center gap-3 max-[640px]:w-full max-[640px]:justify-between">
          <a
            className={buttonVariants({ variant: "outline", size: "icon" })}
            data-slot="button"
            data-size="icon"
            data-variant="outline"
            aria-label="Previous date"
            href={params(addDays(date, -rangeStep), view, barberId)}
          >
            ‹
          </a>
          <strong aria-live="polite" className="min-w-[126px] text-center">
            {periodLabel}
          </strong>
          <a
            className={buttonVariants({ variant: "outline", size: "icon" })}
            data-slot="button"
            data-size="icon"
            data-variant="outline"
            aria-label="Next date"
            href={params(addDays(date, rangeStep), view, barberId)}
          >
            ›
          </a>
          <a
            className={buttonVariants({ variant: "outline" })}
            data-slot="button"
            data-size="default"
            data-variant="outline"
            href={params(dayNow(calendar.timeZone), view, barberId)}
          >
            Today
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-3 max-[640px]:w-full max-[640px]:justify-between">
          <nav
            className="flex rounded-full border border-border p-[3px]"
            aria-label="Calendar view"
          >
            <a
              className={`rounded-full px-4 py-2 text-sm ${view === "day" ? "bg-secondary font-semibold" : ""}`}
              href={params(date, "day", barberId)}
            >
              Day
            </a>
            <a
              className={`rounded-full px-4 py-2 text-sm ${view === "week" ? "bg-secondary font-semibold" : ""}`}
              href={params(date, "week", barberId)}
            >
              Week
            </a>
          </nav>
          <form
            action="/"
            method="get"
            className="flex flex-wrap items-center gap-2 text-[13px] font-semibold text-muted-foreground"
          >
            <input type="hidden" name="date" value={date} />
            <input type="hidden" name="view" value={view} />
            <label htmlFor="barber-filter">Barber</label>
            <select
              id="barber-filter"
              name="barber"
              defaultValue={barberId ?? "all"}
              className="min-h-11 w-[min(164px,40vw)] min-w-0 max-w-full rounded-xl border border-border bg-background px-3 text-foreground"
            >
              <option value="all">All barbers</option>
              {calendar.barbers.map((barber) => (
                <option key={barber.id} value={barber.id}>
                  {barber.name}
                  {barber.archived ? " (archived)" : ""}
                </option>
              ))}
            </select>
            <Button type="submit" variant="outline">
              Apply
            </Button>
          </form>
        </div>
      </div>
      <section
        className="flex min-h-[560px] flex-[1_0_auto] flex-col overflow-hidden rounded-2xl border border-border bg-background shadow-sm"
        aria-label={`${view === "day" ? "Daily" : "Weekly"} schedule`}
      >
        <header className="border-b border-border px-5 py-3">
          <h2 className="font-medium">
            {view === "day" ? "Daily schedule" : "Weekly schedule"}
          </h2>
          <p className="text-xs text-muted-foreground">
            {periodLabel} ·{" "}
            {barberId
              ? calendar.barbers.find((barber) => barber.id === barberId)?.name
              : "All barbers"}
          </p>
        </header>
        <div
          className="min-h-0 flex-1 overflow-auto overscroll-contain"
          role="region"
          aria-label={view === "day" ? "Daily calendar" : "Weekly calendar"}
          tabIndex={0}
        >
          {calendar.appointments.length === 0 ? (
            <p className="p-6 text-sm text-muted-foreground">
              No appointments in this range.
            </p>
          ) : null}
          {view === "day" ? (
            <div>
              {Array.from({ length: 24 }, (_, index) => index).map((hour) => {
                const events = calendar.appointments.filter(
                  (appointment) =>
                    Number(
                      dateFor(appointment.startAt, calendar.timeZone, {
                        hour: "2-digit",
                        hourCycle: "h23",
                      }),
                    ) === hour,
                );
                return (
                  <div
                    className="grid min-h-24 grid-cols-[76px_minmax(0,1fr)] border-b border-border max-[640px]:grid-cols-[52px_minmax(0,1fr)]"
                    key={hour}
                  >
                    <span className="border-r border-border px-3 py-3 text-right text-xs tabular-nums text-muted-foreground max-[640px]:px-1.5">
                      {String(hour).padStart(2, "0")}:00
                    </span>
                    <div className="grid content-start gap-2 p-2">
                      {events.map((appointment) => (
                        <AppointmentCard
                          key={appointment.id}
                          appointment={appointment}
                          timeZone={calendar.timeZone}
                          date={date}
                          view={view}
                          barberId={barberId}
                          now={now}
                        />
                      ))}
                      <Link
                        className="min-h-10 justify-self-start rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground"
                        href={newAppointmentHref(
                          date,
                          view,
                          barberId,
                          date,
                          `${String(hour).padStart(2, "0")}:00`,
                        )}
                      >
                        + Add at {String(hour).padStart(2, "0")}:00
                        <AppointmentLinkLoading />
                      </Link>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="grid min-w-[900px] grid-cols-7 max-[1099px]:min-w-0 max-[1099px]:block">
              {days.map((dateValue) => {
                const events = calendar.appointments.filter(
                  (appointment) =>
                    dateFor(appointment.startAt, calendar.timeZone, {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }) ===
                    day(dateValue, calendar.timeZone, {
                      year: "numeric",
                      month: "2-digit",
                      day: "2-digit",
                    }),
                );
                return (
                  <section
                    key={dateValue}
                    className="min-w-0 border-r border-border max-[1099px]:border-0 max-[1099px]:border-b"
                    aria-label={day(dateValue, calendar.timeZone, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}
                  >
                    <h3 className="border-b bg-muted px-2 py-3 text-center text-xs font-semibold">
                      {day(dateValue, calendar.timeZone, {
                        weekday: "short",
                        day: "numeric",
                      })}
                    </h3>
                    <div className="grid content-start gap-2 p-2">
                      {events.length ? (
                        events.map((appointment) => (
                          <AppointmentCard
                            key={appointment.id}
                            appointment={appointment}
                            timeZone={calendar.timeZone}
                            date={date}
                            view={view}
                            barberId={barberId}
                            now={now}
                          />
                        ))
                      ) : (
                        <span className="py-3 text-center text-xs text-muted-foreground">
                          No appointments
                        </span>
                      )}
                      <Link
                        className="min-h-10 justify-self-start rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground"
                        href={newAppointmentHref(
                          date,
                          view,
                          barberId,
                          dateValue,
                        )}
                      >
                        + Add appointment
                        <AppointmentLinkLoading />
                      </Link>
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </div>
        <p className="border-t border-border px-5 py-2 text-[11px] text-muted-foreground">
          Select a time to add an appointment. Availability is checked when you
          save. Week starts Monday.
        </p>
      </section>
    </main>
  );
}

function dayNow(timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  return `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}-${parts.find((part) => part.type === "day")!.value}`;
}

function AppointmentCard({
  appointment,
  timeZone,
  date,
  view,
  barberId,
  now,
}: {
  appointment: OwnerCalendarView["appointments"][number];
  timeZone: string;
  date: string;
  view: "day" | "week";
  barberId?: string;
  now: string;
}) {
  const href = `/appointments/${appointment.id}?date=${date}&view=${view}${barberId ? `&barber=${barberId}` : ""}`;
  return (
    <Link
      href={href}
      aria-label={`Appointment: ${appointment.customer.name}, ${appointment.service.name}, ${appointment.barber.name}`}
      className="grid gap-0.5 rounded-xl border border-border bg-muted px-3 py-2 text-left hover:border-[var(--success)]"
    >
      <strong className="text-xs text-[var(--success)]">
        {dateFor(appointment.startAt, timeZone, {
          hour: "2-digit",
          minute: "2-digit",
        })}
        –
        {dateFor(appointment.endAt, timeZone, {
          hour: "2-digit",
          minute: "2-digit",
        })}
      </strong>
      <strong className="text-[13px]">{appointment.customer.name}</strong>
      <span className="text-[11px] text-muted-foreground">
        {appointment.service.name} · {appointment.barber.name}
      </span>
      <span className="w-fit rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold">
        {appointment.status === "cancelled"
          ? "Cancelled"
          : Date.parse(appointment.endAt) <= Date.parse(now)
            ? "Past, unmarked"
            : "Confirmed"}
      </span>
    </Link>
  );
}
