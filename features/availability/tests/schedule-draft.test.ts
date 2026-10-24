import { describe, expect, it } from "vitest";
import {
  draftDayMinutes,
  draftErrors,
  draftFieldId,
  emptyWeek,
  formatHours,
  parseDraftMinute,
  toDraft,
  toWeek,
  weeklyOpenMinutes,
} from "../schedule-draft";
import { dateRangeDrafts, displayBlockInstant } from "../date-editor";
import type { WeeklySchedule } from "../types";

describe("availability schedule drafts", () => {
  it("round trips weekly ranges, including an end-only 24:00", () => {
    const week: WeeklySchedule = [
      {
        working: [{ start: 540, end: 1440 }],
        breaks: [{ start: 720, end: 780 }],
      },
    ];

    expect(toDraft(week)).toEqual([
      {
        working: [{ start: "09:00", end: "24:00" }],
        breaks: [{ start: "12:00", end: "13:00" }],
      },
    ]);
    expect(toWeek(toDraft(week))).toEqual(week);
    expect(
      toWeek([{ working: [{ start: "24:00", end: "bad" }], breaks: [] }]),
    ).toBeNull();
    expect(
      toWeek([{ working: [{ start: "bad", end: "10:00" }], breaks: [] }]),
    ).toBeNull();
    expect(emptyWeek).toHaveLength(7);
  });

  it("rejects malformed times and allows 24:00 only at the end", () => {
    expect(parseDraftMinute("9:00", false)).toBeNull();
    expect(parseDraftMinute("24:00", false)).toBeNull();
    expect(parseDraftMinute("24:00", true)).toBe(1440);
    expect(parseDraftMinute("12:60", true)).toBeNull();
  });

  it("reports invalid draft fields with the editor input ID", () => {
    const draft = [{ working: [{ start: "nope", end: "24:00" }], breaks: [] }];

    expect(Object.keys(draftErrors(draft))).toEqual(["week.0.working.0.start"]);
    expect(draftFieldId("week.0.working.0.start")).toBe("work-0-0-start");
    expect(draftFieldId("week.2.breaks.1.end")).toBe("break-2-1");
  });

  it("shows draft duration after subtracting breaks and treats invalid times as zero", () => {
    expect(
      draftDayMinutes({
        working: [{ start: "09:00", end: "17:00" }],
        breaks: [{ start: "12:00", end: "13:00" }],
      }),
    ).toBe(420);
    expect(formatHours(420)).toBe("7h");
    expect(formatHours(450)).toBe("7h 30m");
    expect(
      draftDayMinutes({
        working: [{ start: "bad", end: "10:00" }],
        breaks: [],
      }),
    ).toBe(600);
  });

  it("totals saved open minutes after breaks", () => {
    expect(
      weeklyOpenMinutes([
        {
          working: [{ start: 540, end: 1020 }],
          breaks: [{ start: 720, end: 780 }],
        },
        { working: [], breaks: [] },
      ]),
    ).toBe(420);
  });
});

describe("dated availability display helpers", () => {
  it("formats the end of day as 24:00 and displays instants in the shop zone", () => {
    expect(dateRangeDrafts([{ start: 540, end: 1440 }])).toEqual([
      { start: "09:00", end: "24:00" },
    ]);
    expect(
      displayBlockInstant("2026-01-02T01:30:00.000Z", "America/Los_Angeles"),
    ).toBe("Jan 1, 2026, 5:30 PM PST");
  });
});
