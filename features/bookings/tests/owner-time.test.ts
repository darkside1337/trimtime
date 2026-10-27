import { expect, it } from "vitest";
import { resolveOwnerStartChoices } from "../time";

it("resolves an ordinary local minute to one exact instant", () => {
  expect(
    resolveOwnerStartChoices("2026-06-15", "10:07", "America/New_York"),
  ).toEqual([{ startAt: "2026-06-15T14:07:00Z", offset: "-04:00" }]);
});

it("returns no choice for a nonexistent local minute", () => {
  expect(
    resolveOwnerStartChoices("2026-03-08", "02:07", "America/New_York"),
  ).toEqual([]);
});

it("returns both explicit occurrences for an ambiguous local minute", () => {
  expect(
    resolveOwnerStartChoices("2026-11-01", "01:37", "America/New_York"),
  ).toEqual([
    { startAt: "2026-11-01T05:37:00Z", offset: "-04:00" },
    { startAt: "2026-11-01T06:37:00Z", offset: "-05:00" },
  ]);
});

it.each([
  ["2026-02-30", "10:07", "America/New_York"],
  ["2026-06-15", "24:00", "America/New_York"],
  ["2026-06-15", "10:07", "Invalid/Zone"],
])("returns no choice for invalid local input %j %j %j", (date, time, zone) => {
  expect(resolveOwnerStartChoices(date, time, zone)).toEqual([]);
});
