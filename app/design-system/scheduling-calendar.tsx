"use client";

import { useRef, useState, type FormEvent, type RefObject } from "react";
import { Temporal } from "temporal-polyfill";
import {
  useCalendarController,
  type DateClickInfo,
  type EventDisplayInfo,
  type EventInput,
} from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import {
  ChevronLeft,
  ChevronRight,
  Clock3,
  Plus,
  Scissors,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
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
import { EventCalendarViews } from "./calendar/event-calendar-views";
import {
  appointmentStart,
  BARBERS,
  createDemoWeek,
  dateLabel,
  SERVICES,
  SHOP_TIME_ZONE,
  shopDateTime,
  timeLabel,
  type DemoAppointment,
} from "./calendar/demo-schedule";
import "./scheduling-calendar.css";

const plugins = [timeGridPlugin, interactionPlugin];
const barberItems = BARBERS.map((barber) => ({
  value: barber.id,
  label: barber.name,
}));
const filterItems = [{ value: "all", label: "All barbers" }, ...barberItems];
const serviceItems = SERVICES.map((service) => ({
  value: service.id,
  label: `${service.name} · ${service.duration} min`,
}));

// Dialog states are local: closed, recorded details, or a creation form.
type CalendarDialog =
  | { kind: "details"; appointment: DemoAppointment }
  | { kind: "create"; date: string; time: string; barberId: string | null }
  | null;

function appointmentContent(info: EventDisplayInfo) {
  const appointment = info.event.extendedProps.appointment as DemoAppointment;
  const barber = BARBERS.find((item) => item.id === appointment.barberId)!;
  const service = SERVICES.find((item) => item.id === appointment.serviceId)!;
  const customerNames = appointment.customer.split(" ");
  const compactCustomer =
    customerNames.length > 1
      ? `${customerNames[0]} ${customerNames.at(-1)![0]}.`
      : appointment.customer;
  return (
    <div className="tt-schedule-appointment">
      <span className="tt-schedule-event-time">
        {timeLabel(appointment.start)}
        <span className="tt-schedule-event-end">
          {" "}
          – {timeLabel(appointment.end)}
        </span>
      </span>
      <strong>
        <span className="tt-schedule-full">{appointment.customer}</span>
        <span className="tt-schedule-compact">{compactCustomer}</span>
      </strong>
      <span className="tt-schedule-event-service">
        <span className="tt-schedule-full">{service.name}</span>
        <span className="tt-schedule-compact">{service.shortName}</span>
      </span>
      <span className="tt-schedule-event-barber">
        <i />
        {barber.name}
      </span>
    </div>
  );
}

export default function SchedulingCalendar({
  portalContainer,
}: {
  portalContainer: RefObject<HTMLDivElement | null>;
}) {
  const controller = useCalendarController();
  const [today] = useState(() =>
    Temporal.Now.plainDateISO(SHOP_TIME_ZONE).toString(),
  );
  const [demoWeek] = useState(() => createDemoWeek(today));
  const [appointments, setAppointments] = useState(demoWeek.appointments);
  const [barberFilter, setBarberFilter] = useState("all");
  const [dialog, setDialog] = useState<CalendarDialog>(null);
  const [notice, setNotice] = useState("");
  const newButton = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const view = controller.view?.type ?? "timeGridDay";

  const events: EventInput[] = appointments
    .filter(
      (appointment) =>
        barberFilter === "all" || appointment.barberId === barberFilter,
    )
    .map((appointment) => ({
      id: appointment.id,
      title: appointment.customer,
      start: appointment.start,
      end: appointment.end,
      className: `tt-schedule-event tt-schedule-barber-${appointment.barberId}`,
      color: `var(--schedule-${appointment.barberId})`,
      contrastColor: "var(--foreground)",
      extendedProps: { appointment },
    }));
  events.push(
    ...demoWeek.unavailable.filter(
      (block) =>
        barberFilter === "all" ||
        !block.extendedProps.barberId ||
        block.extendedProps.barberId === barberFilter,
    ),
  );

  function openCreation(slot?: DateClickInfo) {
    const date = slot
      ? shopDateTime(slot.date)
      : shopDateTime(
          controller.getDate() ??
            appointmentStart(today, "10:00").toInstant().toString(),
        );
    returnFocus.current = slot
      ? newButton.current
      : (document.activeElement as HTMLElement);
    setNotice("");
    setDialog({
      kind: "create",
      date: date.toPlainDate().toString(),
      time: slot
        ? date.toPlainTime().toString({ smallestUnit: "minute" })
        : "10:00",
      barberId: barberFilter === "all" ? null : barberFilter,
    });
  }

  return (
    <article
      id="scheduling-calendar"
      className="tt-exhibit tt-wideExhibit tt-schedule"
    >
      <div className="tt-schedule-heading">
        <div>
          <h3>Scheduling calendar</h3>
          <p>A little clarity for a busy day.</p>
        </div>
        <Badge variant="secondary">Fictional shop · UI demo</Badge>
      </div>
      <div className="tt-schedule-shop">
        <span className="tt-schedule-shop-mark">
          <Scissors />
        </span>
        <div>
          <strong>Sunday Studio</strong>
          <span>Shop time · {SHOP_TIME_ZONE}</span>
        </div>
      </div>
      <div className="tt-schedule-toolbar">
        <div className="tt-schedule-navigation">
          <div className="tt-schedule-date-buttons">
            <Button
              variant="outline"
              size="icon"
              aria-label="Previous calendar period"
              onClick={() => controller.prev()}
            >
              <ChevronLeft />
            </Button>
            <Button
              variant="outline"
              size="icon"
              aria-label="Next calendar period"
              onClick={() => controller.next()}
            >
              <ChevronRight />
            </Button>
          </div>
          <Button variant="outline" onClick={() => controller.today()}>
            Today
          </Button>
          <h4 aria-live="polite">
            {controller.view?.title ?? dateLabel(today)}
          </h4>
        </div>
        <div className="tt-schedule-controls">
          <div
            className="tt-schedule-views"
            role="group"
            aria-label="Calendar view"
          >
            <Button
              variant={view === "timeGridDay" ? "secondary" : "ghost"}
              aria-pressed={view === "timeGridDay"}
              onClick={() => controller.changeView("timeGridDay")}
            >
              Day
            </Button>
            <Button
              variant={view === "timeGridWeek" ? "secondary" : "ghost"}
              aria-pressed={view === "timeGridWeek"}
              onClick={() => controller.changeView("timeGridWeek")}
            >
              Week
            </Button>
          </div>
          <Select
            items={filterItems}
            value={barberFilter}
            onValueChange={(value) => setBarberFilter(value ?? "all")}
          >
            <SelectTrigger aria-label="Filter calendar by barber">
              <SelectValue />
            </SelectTrigger>
            <SelectContent
              container={portalContainer}
              alignItemWithTrigger={false}
            >
              <SelectGroup>
                {filterItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <Button ref={newButton} onClick={() => openCreation()}>
            <Plus data-icon="inline-start" />
            New appointment
          </Button>
        </div>
      </div>
      <div className="tt-schedule-legend">
        {BARBERS.map((barber) => (
          <span key={barber.id} className={`tt-schedule-barber-${barber.id}`}>
            <i />
            {barber.name}
          </span>
        ))}
        <span className="tt-schedule-unavailable-legend">
          <i />
          Unavailable
        </span>
      </div>
      <div
        className={`tt-schedule-scroll ${view === "timeGridWeek" ? "tt-schedule-week" : ""}`}
        role="region"
        aria-label="Demo scheduling calendar; scroll horizontally to see the full week"
        tabIndex={0}
      >
        <EventCalendarViews
          controller={controller}
          plugins={plugins}
          initialDate={today}
          initialView="timeGridDay"
          timeZone={SHOP_TIME_ZONE}
          titleFormat={{ month: "short", day: "numeric", year: "numeric" }}
          headerToolbar={false}
          footerToolbar={false}
          firstDay={1}
          allDaySlot={false}
          height={760}
          scrollTime="09:00:00"
          slotMinTime="09:00:00"
          slotMaxTime="18:00:00"
          slotDuration="00:30:00"
          slotHeaderInterval="01:00:00"
          slotMinHeight={100}
          slotHeaderFormat={{
            hour: "numeric",
            minute: "2-digit",
            meridiem: "short",
          }}
          slotEventOverlap={false}
          eventMinHeight={0}
          eventShortHeight={0}
          editable={false}
          eventStartEditable={false}
          eventDurationEditable={false}
          eventResizableFromStart={false}
          selectable={false}
          eventInteractive
          events={events}
          eventContent={appointmentContent}
          eventDidMount={({ el, event }) => {
            const appointment = event.extendedProps.appointment as
              DemoAppointment | undefined;
            if (!appointment) return;
            el.dataset.appointmentId = appointment.id;
            el.setAttribute(
              "aria-label",
              `${appointment.customer}, ${SERVICES.find((item) => item.id === appointment.serviceId)!.name}, ${BARBERS.find((item) => item.id === appointment.barberId)!.name}, ${timeLabel(appointment.start)} to ${timeLabel(appointment.end)}. Open demo details.`,
            );
          }}
          eventClick={({ event, el }) => {
            const appointment = event.extendedProps.appointment as
              DemoAppointment | undefined;
            if (appointment) {
              returnFocus.current = el;
              setDialog({ kind: "details", appointment });
            }
          }}
          dateClick={openCreation}
          dayHeaderClass="tt-schedule-day-header"
          dayHeaderInnerClass="tt-schedule-day-header-inner"
          dayHeaderContent={(info) => (
            <>
              <span>{info.weekdayText}</span>
              <strong
                className={info.isToday ? "tt-schedule-today" : undefined}
              >
                {info.dayNumberText}
              </strong>
            </>
          )}
          slotLaneClass={(info) =>
            `tt-schedule-slot ${info.isMinor ? "tt-schedule-slot-minor" : ""}`
          }
          columnEventClass={(info) =>
            `${info.isStart ? "tt-schedule-event-start" : ""} ${info.isEnd ? "tt-schedule-event-end" : ""}`
          }
          columnEventInnerClass="tt-schedule-event-inner"
          backgroundEventClass="tt-schedule-unavailable"
          backgroundEventContent={(info) => <span>{info.event.title}</span>}
          nowIndicator={false}
          popoverCloseContent={() => <X />}
        />
      </div>
      <div className="tt-schedule-footnote">
        <p>
          Click an appointment for details, or an empty time for a demo entry.
          Keyboard users can tab to appointments or use New appointment.
        </p>
        <span>Drag & resize off</span>
      </div>
      <p className="tt-schedule-data-note">
        Fictional appointments are anchored to {dateLabel(demoWeek.start)} –{" "}
        {dateLabel(demoWeek.end)}. Other weeks start empty.
      </p>
      <p className="tt-schedule-notice" aria-live="polite">
        {notice}
      </p>
      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      >
        <DialogContent
          container={portalContainer}
          className="tt-schedule-dialog"
          finalFocus={() => returnFocus.current ?? newButton.current}
        >
          {dialog?.kind === "details" ? (
            <AppointmentDetails appointment={dialog.appointment} />
          ) : dialog?.kind === "create" ? (
            <DemoCreationForm
              key={`${dialog.date}-${dialog.time}`}
              initial={dialog}
              portalContainer={portalContainer}
              onCreate={(appointment) => {
                setAppointments((current) => [...current, appointment]);
                setNotice(
                  "Demo appointment added locally. Reload the page to reset.",
                );
                setDialog(null);
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </article>
  );
}

function AppointmentDetails({ appointment }: { appointment: DemoAppointment }) {
  const barber = BARBERS.find((item) => item.id === appointment.barberId)!;
  const service = SERVICES.find((item) => item.id === appointment.serviceId)!;
  return (
    <>
      <Badge variant="secondary" className="tt-schedule-dialog-badge">
        Demo appointment
      </Badge>
      <DialogHeader>
        <DialogTitle>{appointment.customer}</DialogTitle>
        <DialogDescription>
          {dateLabel(shopDateTime(appointment.start).toPlainDate().toString())}
          <br />
          {timeLabel(appointment.start)} – {timeLabel(appointment.end)} ·{" "}
          {SHOP_TIME_ZONE}
        </DialogDescription>
      </DialogHeader>
      <div
        className={`tt-schedule-details-service tt-schedule-barber-${barber.id}`}
      >
        <Scissors />
        <div>
          <strong>{service.name}</strong>
          <span>
            {service.duration} minutes, with {barber.name}
          </span>
        </div>
      </div>
      <dl className="tt-schedule-details">
        <div>
          <dt>Customer</dt>
          <dd>{appointment.customer}</dd>
        </div>
        <div>
          <dt>Barber</dt>
          <dd>{barber.name}</dd>
        </div>
        <div>
          <dt>Shop</dt>
          <dd>Sunday Studio · fictional</dd>
        </div>
      </dl>
      <p className="tt-schedule-dialog-note">
        Fictional details for this component reference. No booking or
        notification has been sent.
      </p>
      <DialogFooter>
        <DialogClose render={<Button variant="outline" />}>
          Back to the calendar
        </DialogClose>
      </DialogFooter>
    </>
  );
}

function DemoCreationForm({
  initial,
  portalContainer,
  onCreate,
}: {
  initial: NonNullable<CalendarDialog> & { kind: "create" };
  portalContainer: RefObject<HTMLDivElement | null>;
  onCreate: (appointment: DemoAppointment) => void;
}) {
  const [customer, setCustomer] = useState("");
  const [barberId, setBarberId] = useState(initial.barberId);
  const [serviceId, setServiceId] = useState("haircut");
  const [date, setDate] = useState(initial.date);
  const [time, setTime] = useState(initial.time);
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!barberId || !customer.trim()) return;
    try {
      const start = appointmentStart(date, time);
      const duration = SERVICES.find(
        (service) => service.id === serviceId,
      )!.duration;
      onCreate({
        id: crypto.randomUUID(),
        customer: customer.trim(),
        barberId,
        serviceId,
        start: start.toInstant().toString(),
        end: start.add({ minutes: duration }).toInstant().toString(),
      });
    } catch {
      setError(
        "This time doesn’t identify one instant in the shop’s time zone. Choose another date or time.",
      );
    }
  }

  return (
    <>
      <Badge variant="secondary" className="tt-schedule-dialog-badge">
        Demo form · local only
      </Badge>
      <DialogHeader>
        <DialogTitle>A little room in the day.</DialogTitle>
        <DialogDescription>
          Add a fictional appointment to this specimen. Availability, conflicts,
          and booking rules are not checked.
        </DialogDescription>
      </DialogHeader>
      <form className="tt-schedule-form" onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="schedule-customer">Customer name</FieldLabel>
            <Input
              id="schedule-customer"
              value={customer}
              onChange={(event) => setCustomer(event.target.value)}
              placeholder="Jamie Morgan"
              autoComplete="off"
              required
            />
          </Field>
          <Field>
            <FieldLabel id="schedule-barber-label">Barber</FieldLabel>
            <Select
              items={barberItems}
              value={barberId}
              onValueChange={setBarberId}
            >
              <SelectTrigger aria-labelledby="schedule-barber-label">
                <SelectValue placeholder="Choose a barber" />
              </SelectTrigger>
              <SelectContent
                container={portalContainer}
                alignItemWithTrigger={false}
              >
                <SelectGroup>
                  {barberItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
            <FieldDescription>
              {initial.barberId
                ? "Prefilled from your calendar filter. You can change it."
                : "All-barber view: choose a barber explicitly."}
            </FieldDescription>
          </Field>
          <Field>
            <FieldLabel id="schedule-service-label">Service</FieldLabel>
            <Select
              items={serviceItems}
              value={serviceId}
              onValueChange={(value) => {
                if (value) setServiceId(value);
              }}
            >
              <SelectTrigger aria-labelledby="schedule-service-label">
                <SelectValue />
              </SelectTrigger>
              <SelectContent
                container={portalContainer}
                alignItemWithTrigger={false}
              >
                <SelectGroup>
                  {serviceItems.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Field>
          <div className="tt-schedule-form-date">
            <Field>
              <FieldLabel htmlFor="schedule-date">Date</FieldLabel>
              <Input
                id="schedule-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="schedule-time">Shop time</FieldLabel>
              <Input
                id="schedule-time"
                type="time"
                step="60"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                required
              />
            </Field>
          </div>
        </FieldGroup>
        <p className="tt-schedule-zone-note">
          <Clock3 />
          {SHOP_TIME_ZONE}
        </p>
        <p className="tt-schedule-form-error" role="status">
          {error}
        </p>
        <p className="tt-schedule-dialog-note">
          Demo entries live in this page only. Nothing is stored or sent, and
          reloading resets the calendar.
        </p>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            type="submit"
            disabled={!customer.trim() || !barberId || !date || !time}
          >
            Add demo appointment <Plus data-icon="inline-end" />
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
