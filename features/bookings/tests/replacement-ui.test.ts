import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CustomerReplacementSlotsView } from "../types";
import { ReplacementStepBarbers } from "../components/manage-booking/replacement-step-barbers";
import { ReplacementStepServices } from "../components/manage-booking/replacement-step-services";
import { ReplacementStepSlots } from "../components/manage-booking/replacement-step-slots";

describe("replacement selection fieldsets", () => {
  it("keeps service and barber choices controlled and labeled", () => {
    const services = renderToStaticMarkup(
      createElement(ReplacementStepServices, {
        choices: {
          bookingId: "booking",
          revision: 1,
          timeZone: "America/New_York",
          serverNow: "2026-11-01T12:00:00.000Z",
          retainedService: {
            id: "cut",
            name: "Cut",
            priceUsd: "25.00",
            durationMinutes: 30,
          },
          services: [
            {
              id: "cut",
              name: "Cut",
              priceUsd: "25.00",
              durationMinutes: 30,
              barberIds: ["sam"],
              hidden: false,
            },
          ],
          barbers: [{ id: "sam", name: "Sam" }],
        },
        serviceId: "cut",
        onServiceChange: () => undefined,
      }),
    );
    const barbers = renderToStaticMarkup(
      createElement(ReplacementStepBarbers, {
        barbers: [{ id: "sam", name: "Sam" }],
        barberId: "sam",
        onBarberChange: () => undefined,
      }),
    );

    expect(services).toContain("checked");
    expect(services).toContain("Your current service");
    expect(services).toContain("1. Choose your service");
    expect(barbers).toContain("checked");
    expect(barbers).toContain("2. Choose your barber");
    expect(barbers).toContain("Sam");
  });

  it("associates the date label and distinguishes both DST fold instants", () => {
    const slots: CustomerReplacementSlotsView["slots"] = [
      {
        start: "2026-11-01T05:30:00.000Z",
        end: "2026-11-01T06:00:00.000Z",
        localStart: "01:30",
        offset: "-04:00",
      },
      {
        start: "2026-11-01T06:30:00.000Z",
        end: "2026-11-01T07:00:00.000Z",
        localStart: "01:30",
        offset: "-05:00",
      },
    ];
    const markup = renderToStaticMarkup(
      createElement(ReplacementStepSlots, {
        date: "2026-11-01",
        slots,
        loading: false,
        error: null,
        barberId: "sam",
        hasAvailableBarbers: true,
        startAt: slots[1].start,
        onDateChange: () => undefined,
        onStartAtChange: () => undefined,
      }),
    );

    expect(markup).toContain('for="replacement-date"');
    expect(markup).toContain('id="replacement-date"');
    expect(markup).toContain("01:30 · UTC-04:00");
    expect(markup).toContain("01:30 · UTC-05:00");
    expect(markup).toContain('value="2026-11-01"');
    expect(markup).toMatch(
      /name="replacement-start" checked="" value="2026-11-01T06:30:00\.000Z"/,
    );
  });
});
