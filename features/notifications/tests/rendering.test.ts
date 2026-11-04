import { afterEach, describe, expect, it } from "vitest";
import {
  encryptCapability,
  hashSecret,
} from "@/features/bookings/capabilities";
import { buildNotificationMessage } from "../rendering";

const booking = {
  id: "booking-1",
  customerName: "Ari Client",
  customerEmail: "ari@example.test",
  customerPhone: null,
  serviceName: "Cut",
  servicePriceUsd: "25.00",
  serviceDurationMinutes: 30,
  barberName: "Sam Barber",
  startAt: "2026-01-15T14:00:00.000Z",
  endAt: "2026-01-15T14:30:00.000Z",
  shop: {
    name: "Northside Barber",
    address: "1 Sample Road",
    publicContact: "Call 555-0100",
    timeZone: "America/New_York",
  },
  shopId: "shop-1",
  subdomain: "northside",
  capabilityHash: "",
  capabilityCiphertext: "",
  capabilityKeyId: "",
};

const originalEncryptionKey = process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY;
const originalKeyId = process.env.BOOKING_CAPABILITY_KEY_ID;

function configureCapability() {
  process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString(
    "base64",
  );
  process.env.BOOKING_CAPABILITY_KEY_ID = "test-key";
  const token = "booking-capability-token";
  const encrypted = encryptCapability(token, "shop-1:booking-1");
  return {
    ...booking,
    capabilityHash: hashSecret(token),
    capabilityCiphertext: encrypted.ciphertext,
    capabilityKeyId: encrypted.keyId,
  };
}

afterEach(() => {
  if (originalEncryptionKey === undefined)
    delete process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY;
  else process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY = originalEncryptionKey;
  if (originalKeyId === undefined) delete process.env.BOOKING_CAPABILITY_KEY_ID;
  else process.env.BOOKING_CAPABILITY_KEY_ID = originalKeyId;
});

describe("notification message building", () => {
  it("reports an unreadable customer capability separately from render failures", () => {
    delete process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY;
    delete process.env.BOOKING_CAPABILITY_KEY_ID;

    expect(
      buildNotificationMessage({
        kind: "customer_confirmation",
        booking,
        recipient: "ari@example.test",
        beforeSnapshot: null,
        changeActor: null,
        activityUrl: "https://northside.trimtime.test/activity",
      }),
    ).toEqual({
      ok: false,
      status: "skipped",
      reason: "capability_unavailable",
    });
  });

  it("reports message formatting failures while preserving capability outcomes", () => {
    const securedBooking = configureCapability();

    expect(
      buildNotificationMessage({
        kind: "customer_confirmation",
        booking: {
          ...securedBooking,
          shop: { ...securedBooking.shop, timeZone: "Invalid/Zone" },
        },
        recipient: "ari@example.test",
        beforeSnapshot: null,
        changeActor: null,
        activityUrl: "https://northside.trimtime.test/activity",
      }),
    ).toEqual({
      ok: false,
      status: "skipped",
      reason: "message_render_failed",
    });
  });

  it("builds owner alerts without requiring a customer capability", () => {
    const result = buildNotificationMessage({
      kind: "owner_alert",
      booking,
      recipient: "owner@example.test",
      beforeSnapshot: null,
      changeActor: null,
      activityUrl: "https://northside.trimtime.test/activity",
    });

    expect(result).toMatchObject({
      ok: true,
      message: {
        to: "owner@example.test",
        subject: "New customer booking — Northside Barber",
      },
    });
  });

  it("renders a reminder with current appointment details, manage link, and demo disclosures", () => {
    const securedBooking = configureCapability();
    const result = buildNotificationMessage({
      kind: "customer_reminder",
      booking: securedBooking,
      recipient: "ari@example.test",
      beforeSnapshot: null,
      changeActor: null,
      activityUrl: "https://northside.trimtime.test/activity",
    });

    expect(result).toMatchObject({
      ok: true,
      message: {
        to: "ari@example.test",
        subject: "Reminder: your upcoming booking — Northside Barber",
      },
    });
    if (result.ok) {
      expect(result.message.text).toContain(
        "This is a reminder about your upcoming booking:",
      );
      expect(result.message.text).toContain(
        "Manage your booking: http://northside.localhost:3100/manage/booking-capability-token",
      );
      expect(result.message.text).toContain(
        "Fictional TrimTime demo. This message is captured locally in Mailpit; inbox delivery is not enabled.",
      );
      expect(result.message.text).toContain(
        "this message does not confirm a cancellation or reschedule.",
      );
    }
  });
});
