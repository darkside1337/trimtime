import { z } from "zod";

export type BookingMessageSnapshot = {
  id: string;
  customerName: string;
  customerEmail: string | null;
  customerPhone?: string | null;
  serviceName: string;
  servicePriceUsd: string;
  serviceDurationMinutes: number;
  barberName: string;
  startAt: Date | string;
  endAt: Date | string;
  shop: {
    name: string;
    address: string;
    publicContact: string;
    timeZone: string;
  };
};

export type OutboundMessage = {
  to: string;
  from: { email: "noreply@trimtime.test"; name: "TrimTime Demo" };
  subject: string;
  text: string;
};

const recipientSchema = z.string().trim().toLowerCase().pipe(z.email());
const demoNotice =
  "Fictional TrimTime demo. This message is captured locally in Mailpit; inbox delivery is not enabled.";

function safeHeader(value: string) {
  if (/[\r\n]/.test(value)) throw new Error("Invalid message header value.");
  return value;
}

function formatTime(value: Date | string, timeZone: string) {
  const date = new Date(value);
  const formatted = new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  const timeZoneOffset = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  })
    .formatToParts(date)
    .find(({ type }) => type === "timeZoneName")?.value;
  const offset =
    timeZoneOffset === "GMT"
      ? "UTC+00:00"
      : timeZoneOffset?.replace(/^GMT/, "UTC");
  return `${formatted} ${timeZone} (${offset})`;
}

function formatUsd(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return `$${whole}.${fraction.slice(0, 2).padEnd(2, "0")}`;
}

function bookingDetails(booking: BookingMessageSnapshot) {
  return [
    `Service: ${booking.serviceName} — ${formatUsd(booking.servicePriceUsd)} USD (${booking.serviceDurationMinutes} minutes)`,
    `Barber: ${booking.barberName}`,
    `Start: ${formatTime(booking.startAt, booking.shop.timeZone)}`,
    `End: ${formatTime(booking.endAt, booking.shop.timeZone)}`,
  ];
}

function createMessage(
  recipient: string,
  subject: string,
  text: string,
): OutboundMessage {
  return {
    to: recipientSchema.parse(recipient),
    from: { email: "noreply@trimtime.test", name: "TrimTime Demo" },
    subject: safeHeader(subject),
    text,
  };
}

export function renderCustomerConfirmation(input: {
  booking: BookingMessageSnapshot;
  recipient: string;
  manageUrl: string;
}): OutboundMessage {
  const { booking } = input;
  return createMessage(
    input.recipient,
    `Booking confirmed — ${safeHeader(booking.shop.name)}`,
    [
      `Hello ${booking.customerName},`,
      "",
      demoNotice,
      "",
      ...bookingDetails(booking),
      "",
      `Shop: ${booking.shop.name}`,
      `Address: ${booking.shop.address}`,
      `Contact: ${booking.shop.publicContact}`,
      `Manage your booking: ${input.manageUrl}`,
      "Online changes are not available within 12 hours of your start. Contact the shop for help; this message does not confirm a cancellation or reschedule.",
    ].join("\n"),
  );
}

export function renderCustomerUpdate(input: {
  booking: BookingMessageSnapshot;
  recipient: string;
  manageUrl: string;
  kind: "move" | "cancel";
  before: { startAt: Date | string; endAt: Date | string };
  actor?: "owner" | "customer";
}): OutboundMessage {
  const { booking, kind, before } = input;
  const moved = kind === "move";
  const actor = input.actor ?? "owner";
  const subject = moved ? "Booking updated" : "Booking cancelled";
  return createMessage(
    input.recipient,
    `${subject} — ${safeHeader(booking.shop.name)}`,
    [
      `Hello ${booking.customerName},`,
      "",
      demoNotice,
      "",
      moved
        ? actor === "customer"
          ? "You have rescheduled your booking. Here are the current saved details:"
          : "The shop has rescheduled your booking. Here are the current saved details:"
        : actor === "customer"
          ? "You have cancelled your booking. The saved appointment details are retained:"
          : "The shop has cancelled your booking. The saved appointment details are retained:",
      moved
        ? "Customer changes require at least 12 hours' notice.\nFor changes with less than 12 hours remaining, contact the shop."
        : "Your manage link is now read-only because this booking was cancelled.",
      `Previously: ${formatTime(before.startAt, booking.shop.timeZone)} to ${formatTime(before.endAt, booking.shop.timeZone)}`,
      ...bookingDetails(booking),
      "",
      `Shop: ${booking.shop.name}`,
      `Address: ${booking.shop.address}`,
      `Contact: ${booking.shop.publicContact}`,
      `Manage your booking: ${input.manageUrl}`,
    ].join("\n"),
  );
}

export function renderOwnerAlert(input: {
  booking: BookingMessageSnapshot;
  recipient: string;
  activityUrl: string;
}): OutboundMessage {
  const { booking } = input;
  return createMessage(
    input.recipient,
    `New customer booking — ${safeHeader(booking.shop.name)}`,
    [
      `Hello ${booking.shop.name},`,
      "",
      demoNotice,
      "",
      `Customer: ${booking.customerName}${booking.customerEmail ? ` <${booking.customerEmail}>` : " (no email provided)"}`,
      ...bookingDetails(booking),
      `Booking ID: ${booking.id}`,
      `Owner activity: ${input.activityUrl}`,
    ].join("\n"),
  );
}

export function renderOwnerCancellationAlert(input: {
  booking: BookingMessageSnapshot;
  recipient: string;
  activityUrl: string;
}): OutboundMessage {
  const { booking } = input;
  return createMessage(
    input.recipient,
    `Customer cancelled — ${safeHeader(booking.shop.name)}`,
    [
      `Hello ${booking.shop.name},`,
      "",
      demoNotice,
      "",
      "The customer has cancelled this appointment. The saved details are retained:",
      `Customer: ${booking.customerName}${booking.customerEmail ? ` <${booking.customerEmail}>` : " (no email provided)"}`,
      ...bookingDetails(booking),
      `Booking ID: ${booking.id}`,
      `Owner activity: ${input.activityUrl}`,
    ].join("\n"),
  );
}

export function renderOwnerMoveAlert(input: {
  booking: BookingMessageSnapshot;
  recipient: string;
  activityUrl: string;
}): OutboundMessage {
  const { booking } = input;
  return createMessage(
    input.recipient,
    `Customer rescheduled — ${safeHeader(booking.shop.name)}`,
    [
      `Hello ${booking.shop.name},`,
      "",
      demoNotice,
      "",
      "The customer has rescheduled this appointment. The saved details are retained:",
      `Customer: ${booking.customerName}${booking.customerEmail ? ` <${booking.customerEmail}>` : " (no email provided)"}`,
      ...bookingDetails(booking),
      `Booking ID: ${booking.id}`,
      `Owner activity: ${input.activityUrl}`,
    ].join("\n"),
  );
}
