import { describe, expect, it } from "vitest";
import { hasUsableRecurringHours } from "../publication-readiness";
import type { WeeklySchedule } from "../types";

describe("publication working hours", () => {
  const week = (working: WeeklySchedule[number]["working"]): WeeklySchedule =>
    Array.from({ length: 7 }, (_, day) => ({
      working: day === 0 ? working : [],
      breaks: [],
    }));

  it("accepts a 35-minute service ending exactly at shared closing time", () => {
    expect(
      hasUsableRecurringHours({
        durationMinutes: "35",
        shopWeek: week([{ start: 550, end: 590 }]),
        barberWeek: week([{ start: 540, end: 600 }]),
      }),
    ).toBe(true);
  });

  it("requires a full grid-aligned fit after intersecting both schedules and breaks", () => {
    expect(
      hasUsableRecurringHours({
        durationMinutes: "35",
        shopWeek: week([{ start: 550, end: 589 }]),
        barberWeek: week([{ start: 540, end: 600 }]),
      }),
    ).toBe(false);
    expect(
      hasUsableRecurringHours({
        durationMinutes: "30",
        shopWeek: week([{ start: 541, end: 571 }]),
        barberWeek: week([{ start: 540, end: 600 }]),
      }),
    ).toBe(false);
    expect(
      hasUsableRecurringHours({
        durationMinutes: "30",
        shopWeek: week([
          { start: 540, end: 555 },
          { start: 555, end: 570 },
        ]),
        barberWeek: week([{ start: 540, end: 570 }]),
      }),
    ).toBe(true);
    const shopWeek = week([{ start: 540, end: 585 }]);
    shopWeek[0]!.breaks = [{ start: 555, end: 570 }];
    expect(
      hasUsableRecurringHours({
        durationMinutes: "30",
        shopWeek,
        barberWeek: week([{ start: 540, end: 600 }]),
      }),
    ).toBe(false);
  });

  it("requires a shared working day and overlapping windows", () => {
    const mondayOnly = week([{ start: 540, end: 600 }]);
    const tuesdayOnly: WeeklySchedule = Array.from({ length: 7 }, (_, day) => ({
      working: day === 1 ? [{ start: 540, end: 600 }] : [],
      breaks: [],
    }));
    expect(
      hasUsableRecurringHours({
        durationMinutes: "30",
        shopWeek: mondayOnly,
        barberWeek: tuesdayOnly,
      }),
    ).toBe(false);
    expect(
      hasUsableRecurringHours({
        durationMinutes: "30",
        shopWeek: week([{ start: 540, end: 555 }]),
        barberWeek: week([{ start: 555, end: 600 }]),
      }),
    ).toBe(false);
  });

  it("accepts an exact midnight close and rejects an invalid or oversized duration", () => {
    expect(
      hasUsableRecurringHours({
        durationMinutes: "30",
        shopWeek: week([{ start: 1410, end: 1440 }]),
        barberWeek: week([{ start: 1410, end: 1440 }]),
      }),
    ).toBe(true);
    expect(
      hasUsableRecurringHours({
        durationMinutes: "31",
        shopWeek: week([{ start: 1410, end: 1440 }]),
        barberWeek: week([{ start: 1410, end: 1440 }]),
      }),
    ).toBe(false);
    expect(
      hasUsableRecurringHours({
        durationMinutes: "99999999999999999999",
        shopWeek: week([{ start: 540, end: 600 }]),
        barberWeek: week([{ start: 540, end: 600 }]),
      }),
    ).toBe(false);
  });
});
