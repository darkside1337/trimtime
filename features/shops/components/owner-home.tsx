"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DesignPreviewNotice } from "./design-preview-notice";
import type { ShopView } from "../queries";

const c = {
  workspace:
    "mx-auto flex w-full min-w-0 max-w-[1480px] flex-[1_0_auto] flex-col gap-4 px-7 py-6 max-[640px]:px-4 max-[640px]:py-4",
  top: "flex flex-wrap items-start justify-between gap-3",
  heading:
    "min-w-0 [&>p]:text-[11px] [&>p]:font-bold [&>p]:uppercase [&>p]:tracking-[.1em] [&>p]:text-[var(--success)] [&>h1]:font-heading [&>h1]:text-[34px] [&>h1]:font-medium [&>h1]:leading-[1.2] [&>h1]:tracking-[-.04em] max-[640px]:[&>h1]:text-[28px] [&>span]:text-[13px] [&>span]:text-[var(--muted-foreground)]",
  primary: "min-h-11 rounded-full px-[18px] max-[640px]:ml-auto",
  status:
    "flex items-center justify-between gap-4 rounded-2xl bg-secondary px-4 py-3 max-[640px]:flex-col max-[640px]:items-start [&>div>p]:text-[13px] [&>a]:shrink-0 [&>a]:text-[13px] [&>a]:font-bold [&>a]:hover:underline",
  controls:
    "flex flex-wrap items-center justify-between gap-3 max-[640px]:items-stretch",
  dateControls:
    "flex flex-wrap items-center gap-3 [&>strong]:min-w-[126px] [&>strong]:text-center max-[640px]:w-full max-[640px]:justify-between max-[640px]:gap-2 max-[640px]:[&>strong]:min-w-0 max-[640px]:[&>strong]:flex-1 max-[640px]:[&>strong]:text-base",
  filters:
    "flex flex-wrap items-center gap-3 max-[640px]:w-full max-[640px]:justify-between",
  segmented:
    "flex items-center gap-0 rounded-full border border-border bg-[var(--surface)] p-[3px] [&>button]:min-h-9 [&>button]:rounded-full",
  barberFilter:
    "flex items-center gap-3 text-[13px] font-semibold text-[var(--muted-foreground)] max-[640px]:min-w-0 max-[640px]:flex-1 max-[640px]:justify-between [&_[data-slot=select-trigger]]:min-h-11 [&_[data-slot=select-trigger]]:min-w-[164px] [&_[data-slot=select-trigger]]:rounded-[var(--radius-control)] [&_[data-slot=select-trigger]]:border-border [&_[data-slot=select-trigger]]:bg-background [&_[data-slot=select-trigger]]:px-3 [&_[data-slot=select-trigger]]:py-2 [&_[data-slot=select-trigger]]:text-foreground max-[640px]:[&_[data-slot=select-trigger]]:min-w-0 max-[640px]:[&_[data-slot=select-trigger]]:flex-1",
  calendar:
    "flex min-h-[560px] flex-[1_0_auto] flex-col overflow-hidden rounded-[var(--radius-surface)] border border-border bg-background shadow-[var(--shadow-resting)]",
  calendarHeader:
    "border-b border-border px-5 py-[14px] max-[640px]:px-[14px] max-[640px]:py-3 [&_h2]:text-base [&_h2]:font-medium [&_p]:text-xs [&_p]:text-[var(--muted-foreground)]",
  scroll: "min-h-0 flex-1 overflow-auto overscroll-contain",
  timeRow:
    "grid min-h-24 grid-cols-[76px_minmax(0,1fr)] border-b border-border max-[640px]:grid-cols-[52px_minmax(0,1fr)]",
  timeLabel:
    "border-r border-border px-3 py-[14px] text-right text-xs tabular-nums text-[var(--muted-foreground)] max-[640px]:px-1.5 max-[640px]:py-3 max-[640px]:text-[11px]",
  slot: "grid min-w-0 content-start gap-2 p-2 px-3 max-[640px]:p-2",
  eventList:
    "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,185px),1fr))] gap-2 max-[520px]:grid-cols-1",
  appointment:
    "grid min-w-0 cursor-pointer gap-0.5 rounded-[var(--radius-control)] border border-border bg-[var(--surface)] px-3 py-2.5 text-left leading-[1.35] text-foreground hover:border-[var(--success)] hover:bg-secondary [&>strong]:[overflow-wrap:anywhere] [&>strong]:text-[13px] [&>span]:text-[11px] [&>span]:text-[var(--muted-foreground)]",
  time: "text-[var(--success)]",
  badge:
    "justify-self-start rounded-full bg-secondary px-[7px] py-0.5 text-[10px] font-bold text-foreground",
  cancelled: "border-dashed opacity-[.68] [&>strong:not(.time)]:line-through",
  addSlot:
    "min-h-11 justify-self-start border-dashed text-xs text-[var(--muted-foreground)]",
  break:
    "col-span-full grid gap-0.5 rounded-[var(--radius-control)] border border-dashed border-border p-2.5 [&>strong]:text-[var(--success)] [&>b]:text-[13px] [&>b]:text-[var(--muted-foreground)] [&>span]:text-[11px] [&>span]:text-[var(--muted-foreground)]",
  calendarFoot:
    "border-t border-border px-5 py-2 text-[11px] text-[var(--muted-foreground)]",
  week: "grid min-w-[900px] grid-cols-7 max-[900px]:min-w-0 max-[900px]:block",
  weekDay:
    "min-w-0 border-r border-border max-[900px]:border-0 max-[900px]:border-b",
  weekCell:
    "grid min-h-[84px] content-start gap-1.5 border-b border-border p-2 [&>span]:text-[11px] [&>span]:tabular-nums [&>span]:text-[var(--muted-foreground)] max-[900px]:min-h-0 max-[900px]:px-[14px] max-[900px]:py-2.5",
  dialogFields: "grid grid-cols-2 gap-3 max-[520px]:grid-cols-1",
  sampleSummary:
    "grid gap-[7px] rounded-[var(--radius-control)] border border-border bg-[var(--surface)] px-[14px] py-3 [&>p]:text-xs [&>p]:leading-[1.4] [&>p]:text-[var(--muted-foreground)]",
  previewMessage:
    "rounded-[var(--radius-small)] bg-secondary px-2.5 py-2 text-xs font-semibold",
  sampleState:
    "rounded-[var(--radius-small)] bg-secondary px-2.5 py-2 text-xs font-semibold",
  appointmentDetails:
    "grid grid-cols-2 gap-2.5 m-0 [&>div]:min-w-0 [&>div]:rounded-[var(--radius-control)] [&>div]:bg-[var(--surface)] [&>div]:px-3 [&>div]:py-2.5 [&>div:last-child]:col-span-full [&_dt]:text-[11px] [&_dt]:text-[var(--muted-foreground)] [&_dd]:mt-1 [&_dd]:text-[13px] [&_dd]:[overflow-wrap:anywhere] max-[520px]:grid-cols-1 max-[520px]:[&>div:last-child]:col-span-auto",
  dialogSection:
    "grid gap-[7px] rounded-[var(--radius-control)] border border-border bg-[var(--surface)] px-[14px] py-3 [&>p]:text-xs [&>p]:leading-[1.4] [&>p]:text-[var(--muted-foreground)]",
  dialogActions: "flex flex-wrap gap-2 [&>button]:rounded-full",
};

const barbers = ["Amal", "Leila", "Youssef"];
const hours = Array.from({ length: 10 }, (_, index) => index + 9);

function addDays(date: string, count: number) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + count);
  return value.toISOString().slice(0, 10);
}

function displayDate(date: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "numeric",
    month: "short",
    ...options,
  }).format(new Date(`${date}T12:00:00Z`));
}

type SampleAppointment = {
  time: string;
  end: string;
  name: string;
  service: string;
  barber: string;
  state: string;
  date: string;
  contact: string;
};

export function OwnerHome({
  shop,
  initialDate,
}: {
  shop: ShopView;
  initialDate: string;
}) {
  const today = initialDate;
  const [date, setDate] = useState(today);
  const [view, setView] = useState<"day" | "week">("day");
  const [barber, setBarber] = useState("all");
  const [selected, setSelected] = useState<SampleAppointment | null>(null);
  const [dialogMode, setDialogMode] = useState<
    "details" | "new" | "move" | "cancel"
  >("details");
  const [newAppointment, setNewAppointment] = useState({
    customer: "",
    contact: "",
    service: "Classic cut",
    barber: "Amal",
    date: today,
    time: "09:00",
  });
  const [actionPreview, setActionPreview] = useState(false);
  const appointments = useMemo<SampleAppointment[]>(
    () => [
      {
        date: today,
        time: "09:00",
        end: "09:30",
        name: "Nadia Benali",
        service: "Classic cut",
        barber: "Amal",
        state: "Past, unmarked",
        contact: "nadia@example.test",
      },
      {
        date: today,
        time: "10:00",
        end: "11:00",
        name: "Karim Haddad",
        service: "Cut & beard",
        barber: "Amal",
        state: "Confirmed",
        contact: "+1 555 010 200",
      },
      {
        date: today,
        time: "10:00",
        end: "10:30",
        name: "Rami Saadi",
        service: "Beard tidy",
        barber: "Leila",
        state: "Confirmed",
        contact: "Not provided",
      },
      {
        date: today,
        time: "10:00",
        end: "10:30",
        name: "Sofia Merabet",
        service: "Classic cut",
        barber: "Youssef",
        state: "Confirmed",
        contact: "sofia@example.test",
      },
      {
        date: today,
        time: "15:00",
        end: "16:00",
        name: "Maya Rahal",
        service: "Cut & beard",
        barber: "Youssef",
        state: "Confirmed",
        contact: "maya@example.test",
      },
      {
        date: addDays(today, 1),
        time: "11:00",
        end: "11:30",
        name: "Samir Bensaid",
        service: "Classic cut",
        barber: "Amal",
        state: "Confirmed",
        contact: "samir@example.test",
      },
      {
        date: addDays(today, 1),
        time: "14:00",
        end: "14:30",
        name: "Lina Bouzid",
        service: "Beard tidy",
        barber: "Leila",
        state: "Cancelled",
        contact: "lina@example.test",
      },
    ],
    [today],
  );
  const weekStart = addDays(
    date,
    -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7),
  );
  const shownDates =
    view === "day"
      ? [date]
      : Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const selectedAppointments = appointments.filter(
    (appointment) =>
      shownDates.includes(appointment.date) &&
      (barber === "all" || appointment.barber === barber),
  );
  const rangeLabel =
    view === "day"
      ? displayDate(date, { weekday: "long", day: "numeric", month: "long" })
      : `${displayDate(weekStart)}–${displayDate(addDays(weekStart, 6), { year: "numeric" })}`;
  const dateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00Z`));

  function changeDate(direction: -1 | 1) {
    setDate(addDays(date, direction * (view === "day" ? 1 : 7)));
  }

  function openNewAppointment(time = "09:00") {
    setSelected(null);
    setDialogMode("new");
    setActionPreview(false);
    setNewAppointment({
      customer: "",
      contact: "",
      service: "Classic cut",
      barber: "Amal",
      date,
      time,
    });
  }

  function appointmentCard(appointment: SampleAppointment) {
    return (
      <button
        className={`${c.appointment} ${appointment.state === "Cancelled" ? c.cancelled : ""}`}
        key={`${appointment.date}-${appointment.time}-${appointment.name}`}
        onClick={() => {
          setSelected(appointment);
          setDialogMode("details");
        }}
        type="button"
        aria-label={`Sample appointment: ${appointment.name}, ${appointment.service}, ${appointment.barber}, ${appointment.time}`}
      >
        <strong className={c.time}>
          {appointment.time}–{appointment.end}
        </strong>
        <strong>{appointment.name}</strong>
        <span>
          {appointment.service} · {appointment.barber}
        </span>
        <span className={c.badge}>Sample · {appointment.state}</span>
      </button>
    );
  }

  return (
    <main className={c.workspace}>
      <header className={c.top}>
        <div className={c.heading}>
          <p>{shop.name} · owner workspace</p>
          <h1>Calendar</h1>
          <span>Shop time zone: {shop.timeZone}</span>
        </div>
        <Button className={c.primary} onClick={() => openNewAppointment()}>
          <Plus data-icon="inline-start" /> New appointment
        </Button>
      </header>
      <div className={c.status} role="status">
        <div>
          <strong>
            {shop.published ? "Shop published" : "Shop unpublished"}
          </strong>
          <p>
            {shop.published
              ? "Your public shop page is available. Calendar examples below are not bookings."
              : "Your schedule stays available while you finish setup. Public booking remains off."}
          </p>
        </div>
        {!shop.published && <Link href="/settings">Review setup</Link>}
      </div>
      <DesignPreviewNotice kind="calendar" />
      <section className={c.controls} aria-label="Calendar controls">
        <div className={c.dateControls}>
          <Button
            variant="outline"
            size="icon"
            aria-label="Previous date"
            onClick={() => changeDate(-1)}
          >
            <ArrowLeft />
          </Button>
          <strong aria-live="polite">{dateLabel}</strong>
          <Button
            variant="outline"
            size="icon"
            aria-label="Next date"
            onClick={() => changeDate(1)}
          >
            <ArrowRight />
          </Button>
          <Button variant="outline" onClick={() => setDate(today)}>
            Today
          </Button>
        </div>
        <div className={c.filters}>
          <div className={c.segmented} role="group" aria-label="Calendar view">
            <Button
              variant={view === "day" ? "secondary" : "ghost"}
              aria-pressed={view === "day"}
              onClick={() => setView("day")}
            >
              Day
            </Button>
            <Button
              variant={view === "week" ? "secondary" : "ghost"}
              aria-pressed={view === "week"}
              onClick={() => setView("week")}
            >
              Week
            </Button>
          </div>
          <label className={c.barberFilter}>
            Barber
            <Select
              value={barber}
              onValueChange={(value) => value && setBarber(value)}
            >
              <SelectTrigger aria-label="Barber">
                <SelectValue>
                  {barber === "all" ? "All barbers" : barber}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">All barbers</SelectItem>
                  {barbers.map((name) => (
                    <SelectItem key={name} value={name}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </label>
        </div>
      </section>
      <section className={c.calendar} aria-label="Sample appointments calendar">
        <div className={c.calendarHeader}>
          <div>
            <h2>{view === "day" ? "Daily schedule" : "Weekly schedule"}</h2>
            <p>
              {rangeLabel} · {barber === "all" ? "All barbers" : barber} ·
              Sample appointments
            </p>
          </div>
        </div>
        <div
          className={c.scroll}
          role="region"
          tabIndex={0}
          aria-label="Scrollable calendar"
        >
          {view === "day" ? (
            <div>
              {hours.map((hour) => {
                const time = `${String(hour).padStart(2, "0")}:00`;
                const events = selectedAppointments.filter(
                  (appointment) =>
                    Number(appointment.time.slice(0, 2)) === hour,
                );
                return (
                  <div className={c.timeRow} key={time}>
                    <span className={c.timeLabel}>{time}</span>
                    <div className={c.slot}>
                      <div className={c.eventList}>
                        {hour === 12 && barber === "all" && (
                          <div className={c.break}>
                            <strong>12:00–13:00</strong>
                            <b>Shop break</b>
                            <span>All barbers</span>
                          </div>
                        )}
                        {events.map(appointmentCard)}
                      </div>
                      <Button
                        className={c.addSlot}
                        variant="outline"
                        onClick={() => openNewAppointment(time)}
                      >
                        + Add at {time}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className={c.week}>
              {shownDates.map((day) => (
                <section
                  className={c.weekDay}
                  key={day}
                  aria-label={displayDate(day, {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                  })}
                >
                  <h3>
                    {displayDate(day, { weekday: "short", day: "numeric" })}
                  </h3>
                  {hours.map((hour) => {
                    const events = selectedAppointments.filter(
                      (appointment) =>
                        appointment.date === day &&
                        Number(appointment.time.slice(0, 2)) === hour,
                    );
                    return (
                      <div className={c.weekCell} key={hour}>
                        <span>{String(hour).padStart(2, "0")}:00</span>
                        <div className={c.eventList}>
                          {events.map(appointmentCard)}
                        </div>
                      </div>
                    );
                  })}
                </section>
              ))}
            </div>
          )}
        </div>
        <p className={c.calendarFoot}>
          Sample appointments are for display only. Week starts Monday.
        </p>
      </section>
      <Dialog
        open={selected !== null || dialogMode !== "details"}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setDialogMode("details");
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === "new"
                ? "New appointment"
                : dialogMode === "move"
                  ? "Move appointment"
                  : dialogMode === "cancel"
                    ? "Cancel appointment"
                    : "Appointment details"}
            </DialogTitle>
            <DialogDescription>
              {dialogMode === "new"
                ? "Walk-in or phone booking · sample only. These fields are not saved."
                : dialogMode === "move"
                  ? `${selected?.name} · preview a different time. Nothing is changed.`
                  : dialogMode === "cancel"
                    ? `${selected?.name} · cancellation example only. Nothing is changed.`
                    : "Illustrative appointment details. This is not a real booking."}
            </DialogDescription>
          </DialogHeader>
          {dialogMode === "new" && (
            <>
              <FieldGroup className={c.dialogFields}>
                <Field>
                  <FieldLabel htmlFor="sample-customer">
                    Customer name
                  </FieldLabel>
                  <Input
                    id="sample-customer"
                    value={newAppointment.customer}
                    onChange={(event) =>
                      setNewAppointment({
                        ...newAppointment,
                        customer: event.target.value,
                      })
                    }
                    placeholder="Sample customer"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sample-contact">
                    Email or phone (optional)
                  </FieldLabel>
                  <Input
                    id="sample-contact"
                    value={newAppointment.contact}
                    onChange={(event) =>
                      setNewAppointment({
                        ...newAppointment,
                        contact: event.target.value,
                      })
                    }
                    placeholder="Sample contact"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sample-service">Service</FieldLabel>
                  <Select
                    value={newAppointment.service}
                    onValueChange={(value) =>
                      value &&
                      setNewAppointment({
                        ...newAppointment,
                        service: value,
                      })
                    }
                  >
                    <SelectTrigger id="sample-service" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        <SelectItem value="Classic cut">Classic cut</SelectItem>
                        <SelectItem value="Beard tidy">Beard tidy</SelectItem>
                        <SelectItem value="Cut & beard">
                          Cut &amp; beard
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="sample-barber">Barber</FieldLabel>
                  <Select
                    value={newAppointment.barber}
                    onValueChange={(value) =>
                      value &&
                      setNewAppointment({
                        ...newAppointment,
                        barber: value,
                      })
                    }
                  >
                    <SelectTrigger id="sample-barber" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectGroup>
                        {barbers.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="sample-date">Date</FieldLabel>
                  <Input
                    id="sample-date"
                    type="date"
                    value={newAppointment.date}
                    onChange={(event) =>
                      setNewAppointment({
                        ...newAppointment,
                        date: event.target.value,
                      })
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sample-time">Start time</FieldLabel>
                  <Input
                    id="sample-time"
                    type="time"
                    value={newAppointment.time}
                    onChange={(event) =>
                      setNewAppointment({
                        ...newAppointment,
                        time: event.target.value,
                      })
                    }
                  />
                </Field>
              </FieldGroup>
              <section
                className={c.sampleSummary}
                aria-label="Sample appointment summary"
              >
                <strong>Appointment summary · sample</strong>
                <p>
                  Service: {newAppointment.service} · Barber:{" "}
                  {newAppointment.barber}
                </p>
                <p>
                  Date: {newAppointment.date} · Start: {newAppointment.time} ·
                  Shop time zone: {shop.timeZone}
                </p>
                <p>
                  Duration: {newAppointment.service === "Cut & beard" ? 60 : 30}{" "}
                  minutes · Price:{" "}
                  {newAppointment.service === "Cut & beard"
                    ? "$48"
                    : newAppointment.service === "Beard tidy"
                      ? "$22"
                      : "$32"}{" "}
                  USD
                </p>
                <p>
                  {newAppointment.contact
                    ? `Sample contact: ${newAppointment.contact}`
                    : "No contact channel · no customer confirmation in this sample."}
                </p>
              </section>
              <p className={c.previewMessage} role="status">
                Preview only · no appointment will be created.
              </p>
            </>
          )}
          {selected && dialogMode === "details" && (
            <>
              <p className={c.sampleState}>Sample · {selected.state}</p>
              <dl className={c.appointmentDetails}>
                <div>
                  <dt>Customer</dt>
                  <dd>{selected.name}</dd>
                </div>
                <div>
                  <dt>Contact · sample</dt>
                  <dd>{selected.contact}</dd>
                </div>
                <div>
                  <dt>Recorded service · sample</dt>
                  <dd>{selected.service}</dd>
                </div>
                <div>
                  <dt>Barber · sample</dt>
                  <dd>{selected.barber}</dd>
                </div>
                <div>
                  <dt>Scheduled time · {shop.timeZone}</dt>
                  <dd>
                    {displayDate(selected.date, {
                      weekday: "long",
                      day: "numeric",
                      month: "long",
                    })}{" "}
                    · {selected.time}–{selected.end}
                  </dd>
                </div>
              </dl>
              <section className={c.dialogSection}>
                <strong>Message status · sample</strong>
                <p>
                  {selected.contact === "Not provided"
                    ? "No contact channel provided · no notification in this sample."
                    : "Example outcome only · no message was sent."}
                </p>
              </section>
              <section className={c.dialogSection}>
                <strong>Available preview actions</strong>
                <p>
                  These sample actions follow sample appointment states and do
                  not promise live booking eligibility. They do not change the
                  sample record or create an appointment.
                </p>
                <div className={c.dialogActions}>
                  {selected.state === "Confirmed" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDialogMode("move");
                        setActionPreview(false);
                      }}
                    >
                      Preview move
                    </Button>
                  )}
                  {selected.state === "Confirmed" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setDialogMode("cancel");
                        setActionPreview(false);
                      }}
                    >
                      Preview cancellation
                    </Button>
                  )}
                  {selected.state === "Past, unmarked" && (
                    <>
                      <Button
                        variant="outline"
                        onClick={() => setActionPreview(true)}
                      >
                        Preview mark completed
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => setActionPreview(true)}
                      >
                        Preview mark no-show
                      </Button>
                    </>
                  )}
                  {selected.state === "Cancelled" && (
                    <Button
                      variant="outline"
                      onClick={() => setActionPreview(true)}
                    >
                      Preview restore
                    </Button>
                  )}
                </div>
                {actionPreview && (
                  <p className={c.previewMessage} role="status">
                    Action preview only · sample appointment state and schedule
                    are unchanged.
                  </p>
                )}
              </section>
            </>
          )}
          {dialogMode === "move" && (
            <>
              <FieldGroup className={c.dialogFields}>
                <Field>
                  <FieldLabel htmlFor="move-date">Date</FieldLabel>
                  <Input
                    id="move-date"
                    type="date"
                    defaultValue={selected?.date}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="move-time">Start time</FieldLabel>
                  <Input
                    id="move-time"
                    type="time"
                    defaultValue={selected?.time}
                  />
                </Field>
              </FieldGroup>
              <Button variant="outline" onClick={() => setActionPreview(true)}>
                Preview new time
              </Button>
              {actionPreview && (
                <p className={c.previewMessage} role="status">
                  Move preview shown in this dialog only. No schedule changed.
                </p>
              )}
            </>
          )}
          {dialogMode === "cancel" && (
            <section className={c.dialogSection}>
              <p>
                Cancel this sample appointment? This confirmation is only a
                preview; the record will not change.
              </p>
              <Button variant="outline" onClick={() => setActionPreview(true)}>
                Preview cancellation
              </Button>
              {actionPreview && (
                <p className={c.previewMessage} role="status">
                  Cancellation state previewed. The sample record and schedule
                  are unchanged.
                </p>
              )}
            </section>
          )}
          <DialogFooter>
            {dialogMode === "new" && (
              <Button
                onClick={() => setActionPreview(true)}
                aria-describedby="preview-appointment-status"
              >
                Preview appointment
              </Button>
            )}
            {dialogMode === "new" && actionPreview && (
              <span
                id="preview-appointment-status"
                className={c.previewMessage}
                role="status"
              >
                Sample preview only · no appointment was created.
              </span>
            )}
            {dialogMode !== "details" && selected && (
              <Button
                variant="ghost"
                onClick={() => {
                  setDialogMode("details");
                  setActionPreview(false);
                }}
              >
                Back to details
              </Button>
            )}
            <DialogClose render={<Button variant="outline" />}>
              Close
            </DialogClose>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
