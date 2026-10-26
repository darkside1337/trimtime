import { randomBytes } from "node:crypto";

export function notificationBookingInput(
  serviceId: string,
  barberId: string,
  email: string,
  changes: Record<string, unknown> = {},
) {
  return {
    serviceId,
    barberId,
    startAt: "2026-11-02T10:00:00.000Z",
    reviewedOffer: { name: "Cut", priceUsd: "25.00", durationMinutes: "30" },
    contact: { name: "Ada Lovelace", email, whatsappOptIn: false },
    recoveryKey: randomBytes(32).toString("base64url"),
    ...changes,
  };
}
