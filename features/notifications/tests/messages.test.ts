import { describe, expect, it } from "vitest";
import {
  renderCustomerConfirmation,
  renderCustomerUpdate,
  renderOwnerAlert,
  renderOwnerCancellationAlert,
  renderOwnerMoveAlert,
} from "../messages";

const booking = {
  id: "booking-1",
  customerName: "Ari Client",
  customerEmail: "ari@example.test",
  serviceName: "Cut",
  servicePriceUsd: "25",
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
};

describe("booking messages", () => {
  it("renders saved booking details with the shop zone and UTC offset", () => {
    const message = renderCustomerConfirmation({
      booking,
      recipient: "ari@example.test",
      manageUrl: "https://northside.trimtime.test/manage/secret-token",
    });

    expect(message.subject).toBe("Booking confirmed — Northside Barber");
    expect(message.text).toContain(
      "Fictional TrimTime demo. This message is captured locally in Mailpit; inbox delivery is not enabled.",
    );
    expect(message.text).toContain("Service: Cut — $25.00 USD (30 minutes)");
    expect(message.text).toContain("Barber: Sam Barber");
    expect(message.text).toContain(
      "Start: Jan 15, 2026, 9:00 AM America/New_York (UTC-05:00)",
    );
    expect(message.text).toContain(
      "End: Jan 15, 2026, 9:30 AM America/New_York (UTC-05:00)",
    );
    expect(message.text).toContain("Northside Barber");
    expect(message.text).toContain("1 Sample Road");
    expect(message.text).toContain("Call 555-0100");
    expect(message.text).toContain(
      "Manage your booking: https://northside.trimtime.test/manage/secret-token",
    );
    expect(message.text).toContain(
      "Online changes are not available within 12 hours",
    );
    expect(message.text).not.toContain("cancel your booking");
  });

  it("formats whole-dollar amounts with cents and gives UTC an explicit offset", () => {
    const message = renderCustomerConfirmation({
      booking: {
        ...booking,
        shop: { ...booking.shop, timeZone: "UTC" },
      },
      recipient: booking.customerEmail,
      manageUrl: "https://northside.trimtime.test/manage/token",
    });

    expect(message.text).toContain("Service: Cut — $25.00 USD (30 minutes)");
    expect(message.text).toContain(
      "Start: Jan 15, 2026, 2:00 PM UTC (UTC+00:00)",
    );
  });

  it("uses saved booking values without consulting changed catalog data", () => {
    const message = renderCustomerConfirmation({
      booking: {
        ...booking,
        serviceName: "Saved Cut",
        servicePriceUsd: "25.00",
        serviceDurationMinutes: 30,
        barberName: "Saved Barber",
      },
      recipient: booking.customerEmail,
      manageUrl: "https://northside.trimtime.test/manage/token",
    });

    expect(message.text).toContain(
      "Service: Saved Cut — $25.00 USD (30 minutes)",
    );
    expect(message.text).toContain("Barber: Saved Barber");
    expect(message.text).not.toContain("New catalog cut");
  });

  it("renders a committed move update from saved values and without the confirmation-only disclaimer", () => {
    const message = renderCustomerUpdate({
      booking: {
        ...booking,
        serviceName: "Saved Cut",
        servicePriceUsd: "31.50",
        serviceDurationMinutes: 45,
        startAt: "2026-01-15T15:00:00.000Z",
        endAt: "2026-01-15T15:45:00.000Z",
      },
      recipient: booking.customerEmail,
      manageUrl: "https://northside.trimtime.test/manage/secret-token",
      kind: "move",
      before: {
        startAt: "2026-01-15T14:00:00.000Z",
        endAt: "2026-01-15T14:30:00.000Z",
      },
    });

    expect(message.subject).toBe("Booking updated — Northside Barber");
    expect(message.text).toContain("The shop has rescheduled your booking.");
    expect(message.text).toContain(
      "Customer changes require at least 12 hours' notice.",
    );
    expect(message.text).toContain(
      "For changes with less than 12 hours remaining, contact the shop.",
    );
    expect(message.text).toContain("Previously: Jan 15, 2026, 9:00 AM");
    expect(message.text).toContain(
      "Service: Saved Cut — $31.50 USD (45 minutes)",
    );
    expect(message.text).toContain("Start: Jan 15, 2026, 10:00 AM");
    expect(message.text).toContain(
      "Manage your booking: https://northside.trimtime.test/manage/secret-token",
    );
    expect(message.text).not.toContain(
      "does not confirm a cancellation or reschedule",
    );
  });

  it("tells customers a cancelled booking's manage link is read-only", () => {
    const message = renderCustomerUpdate({
      booking,
      recipient: booking.customerEmail,
      manageUrl: "https://northside.trimtime.test/manage/secret-token",
      kind: "cancel",
      before: { startAt: booking.startAt, endAt: booking.endAt },
    });

    expect(message.text).toContain("The shop has cancelled your booking.");
    expect(message.text).toContain(
      "Your manage link is now read-only because this booking was cancelled.",
    );
  });

  it("attributes a customer-initiated cancellation to the customer and keeps shop wording for owner cancellations", () => {
    const cancelled = {
      booking,
      recipient: booking.customerEmail,
      manageUrl: "https://northside.trimtime.test/manage/secret-token",
      kind: "cancel" as const,
      before: { startAt: booking.startAt, endAt: booking.endAt },
    };

    const customer = renderCustomerUpdate({ ...cancelled, actor: "customer" });
    expect(customer.text).toContain("You have cancelled your booking.");
    expect(customer.text).toContain(
      "Your manage link is now read-only because this booking was cancelled.",
    );
    expect(customer.text).not.toContain("The shop has cancelled your booking.");

    const owner = renderCustomerUpdate(cancelled);
    expect(owner.text).toContain("The shop has cancelled your booking.");
    expect(owner.text).not.toContain("You have cancelled your booking.");
  });

  it("attributes a customer-initiated reschedule to the customer and keeps shop wording for owner reschedules", () => {
    const moved = {
      booking,
      recipient: booking.customerEmail,
      manageUrl: "https://northside.trimtime.test/manage/secret-token",
      kind: "move" as const,
      before: { startAt: booking.startAt, endAt: booking.endAt },
    };

    const customer = renderCustomerUpdate({ ...moved, actor: "customer" });
    expect(customer.text).toContain("You have rescheduled your booking.");
    expect(customer.text).toContain(
      "Customer changes require at least 12 hours' notice.",
    );
    expect(customer.text).not.toContain(
      "The shop has rescheduled your booking.",
    );

    const owner = renderCustomerUpdate(moved);
    expect(owner.text).toContain("The shop has rescheduled your booking.");
    expect(owner.text).not.toContain("You have rescheduled your booking.");
  });

  it("sends the owner alert to the account email without including the manage token", () => {
    const message = renderOwnerAlert({
      booking,
      recipient: "owner@example.test",
      activityUrl: "https://app.localhost:3100/activity",
    });

    expect(message.to).toBe("owner@example.test");
    expect(message.subject).toBe("New customer booking — Northside Barber");
    expect(message.text).toContain("Customer: Ari Client <ari@example.test>");
    expect(message.text).toContain("Booking ID: booking-1");
    expect(message.text).toContain(
      "Owner activity: https://app.localhost:3100/activity",
    );
    expect(message.text).not.toContain("manage/");
    expect(message.text).not.toContain("secret-token");
  });

  it("tells the owner a customer cancelled with saved details and no manage token", () => {
    const message = renderOwnerCancellationAlert({
      booking,
      recipient: "owner@example.test",
      activityUrl: "https://app.localhost:3100/activity",
    });

    expect(message.to).toBe("owner@example.test");
    expect(message.subject).toBe("Customer cancelled — Northside Barber");
    expect(message.text).toContain(
      "The customer has cancelled this appointment.",
    );
    expect(message.text).toContain("Customer: Ari Client <ari@example.test>");
    expect(message.text).toContain("Service: Cut — $25.00 USD (30 minutes)");
    expect(message.text).toContain("Barber: Sam Barber");
    expect(message.text).toContain(
      "Start: Jan 15, 2026, 9:00 AM America/New_York (UTC-05:00)",
    );
    expect(message.text).toContain("Booking ID: booking-1");
    expect(message.text).toContain(
      "Owner activity: https://app.localhost:3100/activity",
    );
    expect(message.text).not.toContain("manage/");
    expect(message.text).not.toContain("secret-token");
  });

  it("tells the owner a customer rescheduled with saved details and no manage token", () => {
    const message = renderOwnerMoveAlert({
      booking,
      recipient: "owner@example.test",
      activityUrl: "https://app.localhost:3100/activity",
    });

    expect(message.to).toBe("owner@example.test");
    expect(message.subject).toBe("Customer rescheduled — Northside Barber");
    expect(message.text).toContain(
      "The customer has rescheduled this appointment. The saved details are retained:",
    );
    expect(message.text).toContain("Customer: Ari Client <ari@example.test>");
    expect(message.text).toContain("Service: Cut — $25.00 USD (30 minutes)");
    expect(message.text).toContain("Barber: Sam Barber");
    expect(message.text).toContain(
      "Start: Jan 15, 2026, 9:00 AM America/New_York (UTC-05:00)",
    );
    expect(message.text).toContain("Booking ID: booking-1");
    expect(message.text).toContain(
      "Owner activity: https://app.localhost:3100/activity",
    );
    expect(message.text).not.toContain("manage/");
    expect(message.text).not.toContain("secret-token");
  });

  it("keeps names as body text and rejects invalid recipients and header newlines", () => {
    const message = renderCustomerConfirmation({
      booking: { ...booking, customerName: "Ari\nClient" },
      recipient: " ARI@example.test ",
      manageUrl: "https://northside.trimtime.test/manage/token",
    });

    expect(message.to).toBe("ari@example.test");
    expect(message.text).toContain("Hello Ari\nClient,");
    expect(() =>
      renderCustomerConfirmation({
        booking,
        recipient: "bad\n@example.test",
        manageUrl: "https://northside.trimtime.test/manage/token",
      }),
    ).toThrow();
    expect(() =>
      renderCustomerConfirmation({
        booking: { ...booking, shop: { ...booking.shop, name: "Shop\r\nBcc" } },
        recipient: booking.customerEmail,
        manageUrl: "https://northside.trimtime.test/manage/token",
      }),
    ).toThrow();
  });
});
