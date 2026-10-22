import { describe, expect, it } from "vitest";
import { calculateSlots } from "../slots";

describe("recurring slot preview", () => {
  it("excludes a 35-minute start that overlaps occupied time", () => {
    const day = { working: [{ start: 540, end: 660 }], breaks: [] };

    expect(
      calculateSlots({
        date: "2026-11-02",
        timeZone: "UTC",
        now: "2026-10-31T12:00:00Z",
        durationMinutes: 35,
        shopDay: day,
        barberDay: day,
        occupied: [
          { start: "2026-11-02T10:00:00Z", end: "2026-11-02T10:15:00Z" },
        ],
      }),
    ).toEqual([
      {
        start: "2026-11-02T09:00:00Z",
        end: "2026-11-02T09:35:00Z",
        localStart: "09:00",
        offset: "+00:00",
      },
      {
        start: "2026-11-02T09:15:00Z",
        end: "2026-11-02T09:50:00Z",
        localStart: "09:15",
        offset: "+00:00",
      },
      {
        start: "2026-11-02T10:15:00Z",
        end: "2026-11-02T10:50:00Z",
        localStart: "10:15",
        offset: "+00:00",
      },
    ]);
  });

  it("offers clock-quarter starts only when all 35 minutes fit", () => {
    const day = {
      working: [{ start: 550, end: 660 }],
      breaks: [{ start: 600, end: 615 }],
    };

    expect(
      calculateSlots({
        date: "2026-10-22",
        timeZone: "UTC",
        now: "2026-10-22T00:00:00Z",
        durationMinutes: 35,
        shopDay: day,
        barberDay: day,
      }),
    ).toEqual([
      {
        start: "2026-10-22T09:15:00Z",
        end: "2026-10-22T09:50:00Z",
        localStart: "09:15",
        offset: "+00:00",
      },
      {
        start: "2026-10-22T10:15:00Z",
        end: "2026-10-22T10:50:00Z",
        localStart: "10:15",
        offset: "+00:00",
      },
    ]);
  });

  it("intersects different shop and barber hours and excludes the barber's break", () => {
    expect(
      calculateSlots({
        date: "2026-11-02",
        timeZone: "America/New_York",
        now: "2026-10-31T12:00:00Z",
        durationMinutes: 35,
        shopDay: { working: [{ start: 540, end: 660 }], breaks: [] },
        barberDay: {
          working: [{ start: 555, end: 630 }],
          breaks: [{ start: 600, end: 615 }],
        },
      }).map(({ localStart, end }) => [localStart, end]),
    ).toEqual([["09:15", "2026-11-02T14:50:00Z"]]);
  });

  it("keeps exact durations, honors break/closing equality, and rejects overrun", () => {
    const day = {
      working: [{ start: 540, end: 660 }],
      breaks: [{ start: 600, end: 615 }],
    };
    const slots = calculateSlots({
      date: "2026-10-22",
      timeZone: "UTC",
      now: "2026-10-22T00:00:00Z",
      durationMinutes: 30,
      shopDay: day,
      barberDay: day,
    });
    expect(
      slots.map(({ localStart, end }) => [localStart, end]),
    ).toContainEqual(["09:30", "2026-10-22T10:00:00Z"]);
    expect(slots.map(({ localStart }) => localStart)).not.toContain("09:45");
    expect(slots.map(({ localStart }) => localStart)).toContain("10:15");
    expect(slots.map(({ localStart }) => localStart)).toContain("10:30");
  });

  it("applies the one-hour notice and the whole local date at +30", () => {
    const fullDay = { working: [{ start: 0, end: 1440 }], breaks: [] };
    const today = calculateSlots({
      date: "2026-10-22",
      timeZone: "UTC",
      now: "2026-10-22T08:00:00Z",
      durationMinutes: 30,
      shopDay: fullDay,
      barberDay: fullDay,
    });
    expect(today.map(({ localStart }) => localStart)).toContain("09:00");
    expect(today.map(({ localStart }) => localStart)).not.toContain("08:45");
    expect(
      calculateSlots({
        date: "2026-10-22",
        timeZone: "UTC",
        now: "2026-10-22T08:00:00.001Z",
        durationMinutes: 30,
        shopDay: fullDay,
        barberDay: fullDay,
      }).map(({ localStart }) => localStart),
    ).not.toContain("09:00");
    expect(
      calculateSlots({
        date: "2026-11-21",
        timeZone: "America/New_York",
        now: "2026-10-22T12:00:00Z",
        durationMinutes: 30,
        shopDay: fullDay,
        barberDay: fullDay,
      }).map(({ localStart }) => localStart),
    ).toContain("23:15");
    expect(
      calculateSlots({
        date: "2026-11-22",
        timeZone: "America/New_York",
        now: "2026-10-22T12:00:00Z",
        durationMinutes: 30,
        shopDay: fullDay,
        barberDay: fullDay,
      }),
    ).toEqual([]);
    expect(
      calculateSlots({
        date: "2026-10-21",
        timeZone: "America/New_York",
        now: "2026-10-22T00:30:00Z",
        durationMinutes: 30,
        shopDay: fullDay,
        barberDay: fullDay,
      }).map(({ localStart }) => localStart),
    ).toContain("21:30");
  });

  it("allows exact midnight completion but never crosses local midnight", () => {
    const late = { working: [{ start: 1380, end: 1440 }], breaks: [] };
    const exact = calculateSlots({
      date: "2026-10-22",
      timeZone: "UTC",
      now: "2026-10-22T00:00:00Z",
      durationMinutes: 30,
      shopDay: late,
      barberDay: late,
    });
    expect(exact).toContainEqual({
      start: "2026-10-22T23:30:00Z",
      end: "2026-10-23T00:00:00Z",
      localStart: "23:30",
      offset: "+00:00",
    });
    expect(
      calculateSlots({
        date: "2026-10-22",
        timeZone: "UTC",
        now: "2026-10-22T00:00:00Z",
        durationMinutes: 35,
        shopDay: late,
        barberDay: late,
      }).map(({ localStart }) => localStart),
    ).not.toContain("23:30");
  });

  it("omits spring-gap labels and adds actual elapsed duration across the transition", () => {
    const day = { working: [{ start: 0, end: 240 }], breaks: [] };
    const slots = calculateSlots({
      date: "2026-03-08",
      timeZone: "America/New_York",
      now: "2026-03-07T00:00:00Z",
      durationMinutes: 35,
      shopDay: day,
      barberDay: day,
    });
    expect(slots.map(({ localStart }) => localStart)).not.toContain("02:30");
    expect(slots).toContainEqual({
      start: "2026-03-08T06:30:00Z",
      end: "2026-03-08T07:05:00Z",
      localStart: "01:30",
      offset: "-05:00",
    });
    const gapStart = calculateSlots({
      date: "2026-03-08",
      timeZone: "America/New_York",
      now: "2026-03-07T00:00:00Z",
      durationMinutes: 30,
      shopDay: { working: [{ start: 150, end: 240 }], breaks: [] },
      barberDay: { working: [{ start: 150, end: 240 }], breaks: [] },
    });
    expect(gapStart.map(({ localStart }) => localStart)).toContain("03:00");
    expect(gapStart.map(({ localStart }) => localStart)).not.toContain("02:30");
  });

  it("returns both fold instants and evaluates interval membership through the fold", () => {
    const day = { working: [{ start: 0, end: 240 }], breaks: [] };
    const slots = calculateSlots({
      date: "2026-11-01",
      timeZone: "America/New_York",
      now: "2026-10-31T00:00:00Z",
      durationMinutes: 35,
      shopDay: day,
      barberDay: day,
    }).filter(({ localStart }) => localStart === "01:30");
    expect(slots).toEqual([
      {
        start: "2026-11-01T05:30:00Z",
        end: "2026-11-01T06:05:00Z",
        localStart: "01:30",
        offset: "-04:00",
      },
      {
        start: "2026-11-01T06:30:00Z",
        end: "2026-11-01T07:05:00Z",
        localStart: "01:30",
        offset: "-05:00",
      },
    ]);
    const narrow = calculateSlots({
      date: "2026-11-01",
      timeZone: "America/New_York",
      now: "2026-10-31T00:00:00Z",
      durationMinutes: 35,
      shopDay: { working: [{ start: 90, end: 120 }], breaks: [] },
      barberDay: { working: [{ start: 90, end: 120 }], breaks: [] },
    });
    expect(narrow.map(({ start }) => start)).not.toContain(
      "2026-11-01T05:30:00Z",
    );
    const breakDay = {
      working: [{ start: 0, end: 240 }],
      breaks: [{ start: 90, end: 105 }],
    };
    expect(
      calculateSlots({
        date: "2026-11-01",
        timeZone: "America/New_York",
        now: "2026-10-31T00:00:00Z",
        durationMinutes: 30,
        shopDay: breakDay,
        barberDay: breakDay,
      }).filter(({ localStart }) => localStart === "01:30"),
    ).toEqual([]);
  });

  it("handles Lord Howe's half-hour fold and excludes durations that cannot fit", () => {
    const day = { working: [{ start: 0, end: 240 }], breaks: [] };
    const fold = calculateSlots({
      date: "2026-04-05",
      timeZone: "Australia/Lord_Howe",
      now: "2026-04-04T00:00:00Z",
      durationMinutes: 30,
      shopDay: day,
      barberDay: day,
    }).filter(({ localStart }) => localStart === "01:30");
    expect(fold.map(({ start, offset }) => [start, offset])).toEqual([
      ["2026-04-04T14:30:00Z", "+11:00"],
      ["2026-04-04T15:00:00Z", "+10:30"],
    ]);
    expect(
      calculateSlots({
        date: "2026-10-22",
        timeZone: "UTC",
        now: "2026-10-22T00:00:00Z",
        durationMinutes: 120,
        shopDay: { working: [{ start: 540, end: 600 }], breaks: [] },
        barberDay: { working: [{ start: 540, end: 600 }], breaks: [] },
      }),
    ).toEqual([]);
  });
});
