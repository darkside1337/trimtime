import type { ManagedBookingView } from "../../types";

export function appointmentTime(booking: ManagedBookingView) {
  const dateTime = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: booking.shop.timeZone,
  })
    .formatToParts(new Date(booking.startAt))
    .reduce<Record<string, string>>((parts, part) => {
      if (part.type !== "literal") parts[part.type] = part.value;
      return parts;
    }, {});
  const date = new Intl.DateTimeFormat("en", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: booking.shop.timeZone,
  });
  const time = new Intl.DateTimeFormat("en", {
    hour: "numeric",
    minute: "2-digit",
    timeZone: booking.shop.timeZone,
  });
  return {
    date: date.format(new Date(booking.startAt)),
    dateTime: `${dateTime.year}-${dateTime.month}-${dateTime.day}`,
    range: `${time.format(new Date(booking.startAt))} – ${time.format(new Date(booking.endAt))}`,
  };
}
