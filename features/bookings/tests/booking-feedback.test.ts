import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookingStepContact } from "../components/booking-flow/booking-step-contact";
import {
  bookingMessage,
  bookingMessageOffersAnotherTime,
} from "../components/booking-flow/feedback";
import type { BookingService } from "../components/booking-flow/types";

const service: BookingService = {
  id: "cut",
  name: "Cut",
  priceUsd: "35.00",
  durationMinutes: "35",
  barbers: [],
};

function contactMarkup(message: ReturnType<typeof bookingMessage>) {
  return renderToStaticMarkup(
    createElement(BookingStepContact, {
      headingRef: { current: null },
      selectedService: service,
      startAt: "2026-11-02T14:00:00.000Z",
      pending: false,
      message,
      selectedStartIsWithinChangeWindow: false,
      publicContact: "Call 202-555-0142",
      contact: { name: "", email: "", phone: "", whatsappOptIn: false },
      onContactChange: () => undefined,
      onBackToTime: () => undefined,
    }),
  );
}

describe("public booking feedback state", () => {
  it("offers another time only from the explicit typed action", () => {
    expect(
      bookingMessageOffersAnotherTime(
        bookingMessage("error", "Choose another available time."),
      ),
    ).toBe(false);
    expect(
      bookingMessageOffersAnotherTime(
        bookingMessage(
          "error",
          "Choose another available time.",
          "choose-another-time",
        ),
      ),
    ).toBe(true);
    expect(bookingMessageOffersAnotherTime(null)).toBe(false);
  });

  it("does not infer the another-time control from message wording", () => {
    const markup = contactMarkup(
      bookingMessage(
        "error",
        "The form details changed. Choose another available time.",
      ),
    );

    expect(markup).toContain("The form details changed.");
    expect(markup).not.toContain("Choose another time");
  });

  it("keeps the another-time action and its warning when explicitly typed", () => {
    const markup = contactMarkup(
      bookingMessage(
        "error",
        "That time was just taken. No booking was created; your details are still here. Choose another available time.",
        "choose-another-time",
      ),
    );

    expect(markup).toContain("That time was just taken.");
    expect(markup).toContain("Choose another time");
  });

  it("preserves recovery-warning messages without adding the another-time action", () => {
    const markup = contactMarkup(
      bookingMessage(
        "error",
        "We couldn’t confirm whether this booking was saved. Check the same request before starting over.",
      ),
    );

    expect(markup).toContain(
      "We couldn’t confirm whether this booking was saved.",
    );
    expect(markup).toContain('role="alert"');
    expect(markup).not.toContain("Choose another time");
  });
});
