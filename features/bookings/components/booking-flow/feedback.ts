export type BookingMessageAction = "choose-another-time";

export type BookingMessage = {
  kind: "error" | "info";
  text: string;
  action?: BookingMessageAction;
};

export function bookingMessage(
  kind: BookingMessage["kind"],
  text: string,
  action?: BookingMessageAction,
): BookingMessage {
  return action ? { kind, text, action } : { kind, text };
}

export function bookingMessageOffersAnotherTime(
  message: BookingMessage | null,
): boolean {
  return message?.action === "choose-another-time";
}
