import { describe, expect, it } from "vitest";
import {
  dateScheduleSchema,
  saveBarberScheduleSchema,
  saveShopScheduleSchema,
} from "../schemas";
import type { WeeklySchedule } from "../types";

const closed = (): WeeklySchedule =>
  Array.from({ length: 7 }, () => ({ working: [], breaks: [] }));

describe("recurring schedule schemas", () => {
  it("accepts a closed week, off-grid ranges, contained breaks, and midnight ends", () => {
    const week = closed();
    week[0] = {
      working: [
        { start: 550, end: 1440 },
        { start: 0, end: 30 },
      ],
      breaks: [{ start: 600, end: 615 }],
    };
    expect(
      saveShopScheduleSchema.safeParse({ week, revision: 0 }).success,
    ).toBe(true);
  });

  it("rejects malformed ranges, overlaps, escaping breaks, revisions, and unknown authority", () => {
    const valid = { week: closed(), revision: 0 };
    expect(
      saveShopScheduleSchema.safeParse({ ...valid, week: valid.week.slice(1) })
        .success,
    ).toBe(false);
    expect(
      saveShopScheduleSchema.safeParse({ ...valid, revision: -1 }).success,
    ).toBe(false);
    expect(
      saveShopScheduleSchema.safeParse({ ...valid, shopId: "foreign" }).success,
    ).toBe(false);
    const invalid = closed();
    invalid[0] = {
      working: [
        { start: 600.5, end: 700 },
        { start: 650, end: 720 },
      ],
      breaks: [{ start: 700, end: 710 }],
    };
    expect(
      saveShopScheduleSchema.safeParse({ week: invalid, revision: 0 }).success,
    ).toBe(false);
    expect(
      saveBarberScheduleSchema.safeParse({ ...valid, barberId: "not-a-uuid" })
        .success,
    ).toBe(false);
  });

  it("reports each invalid range at its nested field path", () => {
    const week = closed();
    week[0] = {
      working: [
        { start: 660, end: 600 },
        { start: 540, end: 480 },
      ],
      breaks: [{ start: 700, end: 710 }],
    };
    const parsed = saveShopScheduleSchema.safeParse({ week, revision: 0 });
    expect(parsed.success).toBe(false);
    if (!parsed.success)
      expect(parsed.error.issues.map((issue) => issue.path.join("."))).toEqual([
        "week.0.working.0.end",
        "week.0.working.1.end",
        "week.0.breaks.0.start",
      ]);
  });

  it("validates dated schedule calendar dates and replacement ranges", () => {
    const valid = {
      date: "2028-02-29",
      timeZone: "UTC",
      override: { working: [], breaks: [] },
      closed: false,
      revision: 0,
    };
    expect(dateScheduleSchema.safeParse(valid).success).toBe(true);
    expect(
      dateScheduleSchema.safeParse({ ...valid, date: "2026-02-30" }).success,
    ).toBe(false);
    expect(
      dateScheduleSchema.safeParse({ ...valid, revision: -1 }).success,
    ).toBe(false);
    expect(
      dateScheduleSchema.safeParse({
        ...valid,
        override: { working: [{ start: 1440, end: 1440 }], breaks: [] },
      }).success,
    ).toBe(false);
  });
});
