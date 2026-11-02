import { describe, expect, it } from "vitest";
import { toManagedBookingView } from "../managed-booking-view";
import type { BookingStatus } from "../types";

const NOW = new Date("2026-11-01T12:00:00.000Z");
const TWELVE_HOURS_MS = 12 * 60 * 60_000;

const notifications = {
  email: {
    status: "captured" as const,
    reason: null,
    updatedAt: "2026-11-01T11:59:00.000Z",
  },
};

function row(
  overrides: {
    status?: BookingStatus;
    startAt?: Date | string;
    endAt?: Date | string;
    customerEmail?: string | null;
    customerPhone?: string | null;
  } = {},
) {
  return {
    revision: 3,
    status: overrides.status ?? ("confirmed" as BookingStatus),
    startAt: overrides.startAt ?? new Date(NOW.getTime() + 24 * 60 * 60_000),
    endAt: overrides.endAt ?? new Date(NOW.getTime() + 25 * 60 * 60_000),
    serviceName: "Cut",
    servicePriceUsd: "35.00",
    serviceDurationMinutes: 35,
    barberName: "Sam",
    customerName: "Ada Lovelace",
    customerEmail:
      overrides.customerEmail === undefined
        ? "ada@example.test"
        : overrides.customerEmail,
    customerPhone:
      overrides.customerPhone === undefined ? null : overrides.customerPhone,
    whatsappOptIn: false,
    shopName: "TrimTime",
    publicContact: "Call 202-555-0142",
    address: "1 Main St",
    timeZone: "America/New_York",
    notifications,
  };
}

describe("managed booking view", () => {
  it("allows the exact 12-hour cutoff, denies 1ms inside, and allows 1ms outside", () => {
    const exact = toManagedBookingView(
      row({ startAt: new Date(NOW.getTime() + TWELVE_HOURS_MS) }),
      NOW,
    );
    const justInside = toManagedBookingView(
      row({ startAt: new Date(NOW.getTime() + TWELVE_HOURS_MS - 1) }),
      NOW,
    );
    const justOutside = toManagedBookingView(
      row({ startAt: new Date(NOW.getTime() + TWELVE_HOURS_MS + 1) }),
      NOW,
    );

    expect(exact.changeCutoffPassed).toBe(false);
    expect(justInside.changeCutoffPassed).toBe(true);
    expect(justOutside.changeCutoffPassed).toBe(false);
  });

  it.each(["cancelled", "completed", "no_show"] as const)(
    "passes the cutoff for the non-confirmed %s state even when far in the future",
    (status) => {
      const view = toManagedBookingView(row({ status }), NOW);

      expect(view.status).toBe(status);
      expect(view.changeCutoffPassed).toBe(true);
    },
  );

  it("retains the notification projection, nullable contact fields, and normalized instants", () => {
    const startAt = "2026-11-03T15:30:00.000Z";
    const endAt = "2026-11-03T16:05:00.000Z";
    const view = toManagedBookingView(
      row({
        startAt,
        endAt,
        status: "confirmed",
        customerEmail: null,
        customerPhone: null,
      }),
      NOW,
    );

    expect(view.startAt).toBe(startAt);
    expect(view.endAt).toBe(endAt);
    expect(view.customer.email).toBeNull();
    expect(view.customer.phone).toBeNull();
    expect(view.notifications).toBe(notifications);
    expect(view.revision).toBe(3);
    expect(view.service).toEqual({
      name: "Cut",
      priceUsd: "35.00",
      durationMinutes: 35,
    });
  });

  it("marks the appointment past at the exact scheduled end and not 1ms before", () => {
    const beforeEnd = toManagedBookingView(
      row({
        startAt: new Date(NOW.getTime() - 60_000),
        endAt: new Date(NOW.getTime() + 1),
      }),
      NOW,
    );
    const atEnd = toManagedBookingView(
      row({
        startAt: new Date(NOW.getTime() - 60_000),
        endAt: new Date(NOW.getTime()),
      }),
      NOW,
    );

    expect(beforeEnd.past).toBe(false);
    expect(atEnd.past).toBe(true);
  });
});
