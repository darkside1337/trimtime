import { notificationContentIdentity } from "./content-identity";
import type { BookingMessageSnapshot } from "./messages";

export type NotificationKind =
  | "customer_confirmation"
  | "owner_alert"
  | "customer_move"
  | "customer_cancellation"
  | "customer_restoration"
  | "owner_cancellation"
  | "owner_move";

type EligibilityInput = {
  kind: string;
  booking: BookingMessageSnapshot & {
    revision: number;
    status: string;
    customerPhone: string | null;
    capabilityRevokedAt: Date | null;
  };
  bookingId: string;
  workRevision: number;
  changeKind: string | null;
  changeActor: string | null;
  changeRevision: number | null;
  recipient: string | null;
  ownerEmail: string | null;
  expectedContentIdentity: string;
  now: Date;
  emailAvailable: boolean;
  emailUnavailableReason: string;
};

export type EligibilityResult =
  | { eligible: true; recipient: string }
  | {
      eligible: false;
      status: "unavailable" | "skipped" | "suppressed";
      reason: string;
    };

const customerKinds = new Set<string>([
  "customer_confirmation",
  "customer_move",
  "customer_cancellation",
  "customer_restoration",
]);

export function evaluateNotificationEligibility(
  input: EligibilityInput,
): EligibilityResult {
  if (!input.emailAvailable) {
    return {
      eligible: false,
      status: "unavailable",
      reason: input.emailUnavailableReason,
    };
  }
  if (!input.recipient) {
    return {
      eligible: false,
      status: "skipped",
      reason: "recipient_missing",
    };
  }

  const expectedRecipient = customerKinds.has(input.kind)
    ? input.booking.customerEmail
    : input.ownerEmail;
  const currentCancellation =
    input.changeKind === "cancel" &&
    input.changeRevision === input.workRevision;
  const currentMove =
    input.changeKind === "move" && input.changeRevision === input.workRevision;

  const stateIsCurrent =
    input.kind === "customer_confirmation" || input.kind === "owner_alert"
      ? input.booking.status === "confirmed" && input.booking.revision === 0
      : input.kind === "customer_move"
        ? input.booking.status === "confirmed" &&
          input.booking.revision === input.workRevision &&
          currentMove
        : input.kind === "owner_move"
          ? input.booking.status === "confirmed" &&
            input.booking.revision === input.workRevision &&
            currentMove &&
            input.changeActor === "customer"
          : input.kind === "customer_cancellation"
            ? input.booking.status === "cancelled" &&
              input.booking.revision === input.workRevision &&
              currentCancellation
            : input.kind === "customer_restoration"
              ? input.booking.status === "confirmed" &&
                input.booking.revision === input.workRevision &&
                input.changeKind === "restore" &&
                input.changeRevision === input.workRevision &&
                input.changeActor === "owner"
              : input.kind === "owner_cancellation"
                ? input.booking.status === "cancelled" &&
                  input.booking.revision === input.workRevision &&
                  currentCancellation &&
                  input.changeActor === "customer"
                : false;

  const contentIdentity = notificationContentIdentity({
    id: input.bookingId,
    startAt: input.booking.startAt,
    endAt: input.booking.endAt,
    serviceName: input.booking.serviceName,
    servicePriceUsd: input.booking.servicePriceUsd,
    serviceDurationMinutes: input.booking.serviceDurationMinutes,
    barberName: input.booking.barberName,
    customerName: input.booking.customerName,
    customerEmail: input.booking.customerEmail,
    customerPhone: input.booking.customerPhone ?? null,
  });
  const expired =
    new Date(input.booking.endAt).getTime() + 7 * 24 * 60 * 60_000 <=
    input.now.getTime();

  if (
    !stateIsCurrent ||
    input.booking.capabilityRevokedAt ||
    expired ||
    input.recipient !== expectedRecipient ||
    input.expectedContentIdentity !== contentIdentity
  ) {
    return {
      eligible: false,
      status: "suppressed",
      reason: "work_no_longer_eligible",
    };
  }

  return { eligible: true, recipient: input.recipient };
}
