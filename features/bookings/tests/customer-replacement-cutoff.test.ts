import { describe, expect, it } from "vitest";
import { checkCutoffWithin12Hours } from "../components/manage-booking/cutoff-warning";

describe("checkCutoffWithin12Hours", () => {
  const TWELVE_HOURS_MS = 12 * 60 * 60_000;
  const BASE_TIME_MS = new Date("2026-11-01T12:00:00.000Z").getTime();

  it("qualifies on exact 12-hour boundary (equality qualifies within approved rules)", () => {
    const slotAtExact12Hours = new Date(
      BASE_TIME_MS + TWELVE_HOURS_MS,
    ).toISOString();

    const serverClock = {
      serverTimeMs: BASE_TIME_MS,
      recordedAtMonotonicMs: performance.now(),
      networkDelayMs: 0,
    };

    // Client Date.now set to BASE_TIME_MS
    const originalNow = Date.now;
    try {
      Date.now = () => BASE_TIME_MS;
      expect(checkCutoffWithin12Hours(slotAtExact12Hours, serverClock)).toBe(
        true,
      );
    } finally {
      Date.now = originalNow;
    }
  });

  it("does not qualify 1 millisecond beyond 12 hours without network delay", () => {
    const slotJustBeyond12Hours = new Date(
      BASE_TIME_MS + TWELVE_HOURS_MS + 1,
    ).toISOString();

    const serverClock = {
      serverTimeMs: BASE_TIME_MS,
      recordedAtMonotonicMs: performance.now(),
      networkDelayMs: 0,
    };

    const originalNow = Date.now;
    try {
      Date.now = () => BASE_TIME_MS;
      expect(checkCutoffWithin12Hours(slotJustBeyond12Hours, serverClock)).toBe(
        false,
      );
    } finally {
      Date.now = originalNow;
    }
  });

  it("conservatively qualifies when network transit delay brings server projection within 12 hours", () => {
    // 500ms beyond 12 hours if network delay were omitted
    const slotIso = new Date(
      BASE_TIME_MS + TWELVE_HOURS_MS + 500,
    ).toISOString();

    // 1000ms roundtrip delay recorded on receipt
    const serverClockWithDelay = {
      serverTimeMs: BASE_TIME_MS,
      recordedAtMonotonicMs: performance.now(),
      networkDelayMs: 1000,
    };

    const originalNow = Date.now;
    try {
      Date.now = () => BASE_TIME_MS;
      // Without delay, 500ms > 12h. With delay accounted for, server time is conservatively at least BASE_TIME_MS + 1000ms,
      // so diff is (TWELVE_HOURS_MS + 500) - 1000 = TWELVE_HOURS_MS - 500 <= 12 hours!
      expect(checkCutoffWithin12Hours(slotIso, serverClockWithDelay)).toBe(
        true,
      );
    } finally {
      Date.now = originalNow;
    }
  });

  it("prevents omission under client clock skew when client is behind server time", () => {
    // Slot is 10 hours from real server time
    const slotIso = new Date(BASE_TIME_MS + 10 * 60 * 60_000).toISOString();

    const serverClock = {
      serverTimeMs: BASE_TIME_MS,
      recordedAtMonotonicMs: performance.now(),
      networkDelayMs: 50,
    };

    const originalNow = Date.now;
    try {
      // Client clock is skewed 5 hours into the past (reports 15 hours away)
      Date.now = () => BASE_TIME_MS - 5 * 60 * 60_000;
      expect(checkCutoffWithin12Hours(slotIso, serverClock)).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });

  it("remains conservative when client clock is ahead of server time", () => {
    // Slot is 13 hours from server time, but client clock is ahead by 2 hours (11 hours away)
    const slotIso = new Date(BASE_TIME_MS + 13 * 60 * 60_000).toISOString();

    const serverClock = {
      serverTimeMs: BASE_TIME_MS,
      recordedAtMonotonicMs: performance.now(),
      networkDelayMs: 0,
    };

    const originalNow = Date.now;
    try {
      Date.now = () => BASE_TIME_MS + 2 * 60 * 60_000;
      expect(checkCutoffWithin12Hours(slotIso, serverClock)).toBe(true);
    } finally {
      Date.now = originalNow;
    }
  });

  it("dynamically qualifies as monotonic time advances across the boundary", () => {
    // Slot is 12 hours + 500ms from server time at response receipt
    const slotIso = new Date(
      BASE_TIME_MS + TWELVE_HOURS_MS + 500,
    ).toISOString();

    const recordedMonotonic = performance.now();
    const serverClock = {
      serverTimeMs: BASE_TIME_MS,
      recordedAtMonotonicMs: recordedMonotonic,
      networkDelayMs: 0,
    };

    const originalNow = Date.now;
    const originalPerfNow = performance.now;
    try {
      Date.now = () => BASE_TIME_MS;
      performance.now = () => recordedMonotonic;
      expect(checkCutoffWithin12Hours(slotIso, serverClock)).toBe(false);

      // Monotonic time advances by 600ms while review is open
      performance.now = () => recordedMonotonic + 600;
      expect(checkCutoffWithin12Hours(slotIso, serverClock)).toBe(true);
    } finally {
      Date.now = originalNow;
      performance.now = originalPerfNow;
    }
  });
});
