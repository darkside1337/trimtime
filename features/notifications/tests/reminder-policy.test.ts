import { expect, it } from "vitest";
import { getReminderDueAt } from "../reminder-policy";

it("schedules at start minus 24 elapsed hours", () => {
  expect(
    getReminderDueAt({
      now: new Date("2026-11-03T12:00:00.000Z"),
      startAt: new Date("2026-11-04T12:00:00.001Z"),
    })?.toISOString(),
  ).toBe("2026-11-03T12:00:00.001Z");
});

it("does not schedule at exactly 24 elapsed hours", () => {
  expect(
    getReminderDueAt({
      now: new Date("2026-11-03T12:00:00.000Z"),
      startAt: new Date("2026-11-04T12:00:00.000Z"),
    }),
  ).toBeNull();
});

it("does not schedule below 24 elapsed hours", () => {
  expect(
    getReminderDueAt({
      now: new Date("2026-11-03T12:00:00.000Z"),
      startAt: new Date("2026-11-04T11:59:59.999Z"),
    }),
  ).toBeNull();
});

it("uses 24 elapsed hours across the spring DST transition", () => {
  expect(
    getReminderDueAt({
      now: new Date("2026-03-07T12:00:00.000Z"),
      startAt: new Date("2026-03-08T12:00:00.001Z"),
    })?.toISOString(),
  ).toBe("2026-03-07T12:00:00.001Z");
});

it("uses 24 elapsed hours across the fall DST transition", () => {
  expect(
    getReminderDueAt({
      now: new Date("2026-10-31T12:00:00.000Z"),
      startAt: new Date("2026-11-01T12:00:00.001Z"),
    })?.toISOString(),
  ).toBe("2026-10-31T12:00:00.001Z");
});
