import { Temporal } from "temporal-polyfill";
import type { EventInput } from "@fullcalendar/react";

export const SHOP_TIME_ZONE = "America/New_York";
export const BARBERS = [
  { id: "alex", name: "Alex Rivera" },
  { id: "sam", name: "Sam Brooks" },
  { id: "noah", name: "Noah Ellis" },
];
export const SERVICES = [
  {
    id: "haircut",
    name: "Signature haircut",
    shortName: "Haircut",
    duration: 45,
  },
  { id: "beard", name: "Beard tidy", shortName: "Beard tidy", duration: 30 },
  { id: "both", name: "Cut & beard", shortName: "Cut & beard", duration: 75 },
];

export type DemoAppointment = {
  id: string;
  customer: string;
  barberId: string;
  serviceId: string;
  start: string;
  end: string;
};

export function shopDateTime(date: Date | string) {
  return Temporal.Instant.from(
    typeof date === "string" ? date : date.toISOString(),
  ).toZonedDateTimeISO(SHOP_TIME_ZONE);
}

export function appointmentStart(date: string, time: string) {
  return Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(
    SHOP_TIME_ZONE,
    { disambiguation: "reject" },
  );
}

export function dateLabel(date: string) {
  return Temporal.PlainDate.from(date).toLocaleString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function timeLabel(date: string | Date) {
  return shopDateTime(date).toLocaleString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export function createDemoWeek(today: string) {
  const anchor = Temporal.PlainDate.from(today);
  const monday = anchor.subtract({ days: anchor.dayOfWeek - 1 });
  const customers = [
    "Jamie Morgan",
    "Jordan Lee",
    "Taylor Reed",
    "Casey Park",
    "Riley Bennett",
    "Avery Collins",
    "Morgan Hayes",
    "Drew Wilson",
    "Cameron Blake",
    "Charlie Owen",
    "Robin Quinn",
    "Emery Davis",
    "Jules Martin",
    "Parker Lane",
  ];
  const slots = [
    { time: "10:00", barberId: "alex", serviceId: "haircut" },
    { time: "10:00", barberId: "sam", serviceId: "beard" },
    { time: "11:00", barberId: "noah", serviceId: "both" },
    { time: "14:00", barberId: "alex", serviceId: "haircut" },
    { time: "15:30", barberId: "sam", serviceId: "both" },
  ];
  const appointments: DemoAppointment[] = [];
  const unavailable: (EventInput & {
    extendedProps: { barberId: string | null };
  })[] = [];
  for (let day = 0; day < 7; day++) {
    const date = monday.add({ days: day }).toString();
    slots.forEach((slot, index) => {
      const start = appointmentStart(date, slot.time);
      const duration = SERVICES.find(
        (service) => service.id === slot.serviceId,
      )!.duration;
      appointments.push({
        id: `demo-${day}-${index}`,
        customer: customers[(day * 3 + index) % customers.length],
        barberId: slot.barberId,
        serviceId: slot.serviceId,
        start: start.toInstant().toString(),
        end: start.add({ minutes: duration }).toInstant().toString(),
      });
    });
    if (day === 2 || day === 4) {
      unavailable.push({
        id: `lunch-${day}`,
        title: "Lunch · all barbers",
        display: "background",
        start: appointmentStart(date, "12:30").toInstant().toString(),
        end: appointmentStart(date, "13:15").toInstant().toString(),
        extendedProps: { barberId: null },
      });
    }
    if (day === 1) {
      unavailable.push({
        id: "alex-away",
        title: "Alex Rivera · away",
        display: "background",
        start: appointmentStart(date, "16:00").toInstant().toString(),
        end: appointmentStart(date, "17:00").toInstant().toString(),
        extendedProps: { barberId: "alex" },
      });
    }
  }
  return {
    appointments,
    unavailable,
    start: monday.toString(),
    end: monday.add({ days: 6 }).toString(),
  };
}
