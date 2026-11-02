import { describe, expect, it } from "vitest";
import {
  evaluatePublicationReadiness,
  PUBLICATION_REQUIREMENTS,
  publicationNotReadyMessage,
  publicationRequirementLabels,
  type PublicationReadinessFacts,
} from "../publication-readiness";
import type { WeeklySchedule } from "@/features/availability/types";

const week = (
  working: WeeklySchedule[number]["working"] = [],
  breaks: WeeklySchedule[number]["breaks"] = [],
): WeeklySchedule =>
  Array.from({ length: 7 }, (_, day) => ({
    working: day === 0 ? working : [],
    breaks: day === 0 ? breaks : [],
  }));

function facts(
  overrides: Partial<PublicationReadinessFacts> = {},
): PublicationReadinessFacts {
  return {
    shop: {
      name: "Juniper Barber",
      publicContact: "Call 202-555-0142",
      address: "123 Example Street",
    },
    shopWeek: week([{ start: 540, end: 600 }]),
    services: [{ durationMinutes: "35", barberIds: ["barber-1"] }],
    barbers: [
      {
        id: "barber-1",
        archived: false,
        week: week([{ start: 540, end: 600 }]),
      },
    ],
    ...overrides,
  };
}

describe("publication readiness", () => {
  it("keeps the display labels, order, and publish error copy", () => {
    expect(
      PUBLICATION_REQUIREMENTS.map(({ key, title, label }) => ({
        key,
        title,
        label,
      })),
    ).toEqual([
      { key: "shop-details", title: "Shop details", label: "shop details" },
      {
        key: "offered-service",
        title: "Services",
        label: "an offered service",
      },
      {
        key: "active-barber-assignment",
        title: "Staff assigned",
        label: "an active barber assigned to a service",
      },
      {
        key: "shared-hours",
        title: "Usable hours",
        label: "shared recurring hours with a complete 15-minute-grid start",
      },
    ]);
    expect(
      publicationRequirementLabels([
        "active-barber-assignment",
        "shop-details",
      ]),
    ).toEqual(["an active barber assigned to a service", "shop details"]);
    expect(
      publicationNotReadyMessage([
        "offered-service",
        "active-barber-assignment",
        "shared-hours",
      ]),
    ).toBe(
      "Add an offered service, an active barber assigned to a service, shared recurring hours with a complete 15-minute-grid start before publishing.",
    );
  });

  it("reports ready only when every structural requirement is satisfied", () => {
    expect(evaluatePublicationReadiness(facts())).toEqual({
      ready: true,
      missing: [],
    });
  });

  it("treats blank shop details as incomplete in display order", () => {
    for (const shop of [
      { ...facts().shop, name: " " },
      { ...facts().shop, publicContact: "\t" },
      { ...facts().shop, address: "" },
    ]) {
      expect(evaluatePublicationReadiness(facts({ shop }))).toEqual({
        ready: false,
        missing: ["shop-details"],
      });
    }
  });

  it("reports an offered service before an eligible assignment and shared hours", () => {
    expect(
      evaluatePublicationReadiness(
        facts({ services: [], barbers: [], shopWeek: null }),
      ),
    ).toEqual({
      ready: false,
      missing: ["offered-service", "active-barber-assignment", "shared-hours"],
    });
  });

  it("does not count an archived barber as an active assignment", () => {
    expect(
      evaluatePublicationReadiness(
        facts({
          barbers: [
            {
              id: "barber-1",
              archived: true,
              week: week([{ start: 540, end: 600 }]),
            },
          ],
        }),
      ),
    ).toEqual({
      ready: false,
      missing: ["active-barber-assignment", "shared-hours"],
    });
  });

  it("keeps structural hours missing when a shop or barber schedule is absent", () => {
    expect(evaluatePublicationReadiness(facts({ shopWeek: null }))).toEqual({
      ready: false,
      missing: ["shared-hours"],
    });
    expect(
      evaluatePublicationReadiness(
        facts({
          barbers: [{ id: "barber-1", archived: false, week: null }],
        }),
      ),
    ).toEqual({
      ready: false,
      missing: ["shared-hours"],
    });
  });

  it("requires a full-duration fit on the shared 15-minute grid after breaks", () => {
    expect(
      evaluatePublicationReadiness(
        facts({
          shopWeek: week([{ start: 540, end: 580 }]),
          barbers: [
            {
              id: "barber-1",
              archived: false,
              week: week([{ start: 540, end: 580 }]),
            },
          ],
        }),
      ),
    ).toEqual({ ready: true, missing: [] });
    expect(
      evaluatePublicationReadiness(
        facts({
          shopWeek: week([{ start: 540, end: 570 }]),
          barbers: [
            {
              id: "barber-1",
              archived: false,
              week: week([{ start: 540, end: 570 }]),
            },
          ],
        }),
      ),
    ).toEqual({ ready: false, missing: ["shared-hours"] });
    expect(
      evaluatePublicationReadiness(
        facts({
          barbers: [
            {
              id: "barber-1",
              archived: false,
              week: week(
                [{ start: 540, end: 600 }],
                [{ start: 555, end: 575 }],
              ),
            },
          ],
        }),
      ),
    ).toEqual({ ready: false, missing: ["shared-hours"] });
  });

  it("is ready when any offered service has an active, usable assignment", () => {
    expect(
      evaluatePublicationReadiness(
        facts({
          services: [
            { durationMinutes: "35", barberIds: [] },
            { durationMinutes: "30", barberIds: ["barber-1"] },
          ],
        }),
      ),
    ).toEqual({ ready: true, missing: [] });
  });
});
