import { describe, expect, it } from "vitest";
import { getBlockBoundaryChoices } from "../block-times";

describe("time block wall-time choices", () => {
  it("offers both explicit offsets for repeated times and none for gaps", () => {
    expect(
      getBlockBoundaryChoices({
        date: "2026-11-01",
        minute: 90,
        timeZone: "America/New_York",
      }),
    ).toEqual([
      { instant: "2026-11-01T05:30:00Z", offset: "-04:00" },
      { instant: "2026-11-01T06:30:00Z", offset: "-05:00" },
    ]);
    expect(
      getBlockBoundaryChoices({
        date: "2026-03-08",
        minute: 150,
        timeZone: "America/New_York",
      }),
    ).toEqual([]);
  });
  it("supports half-hour folds and exact next midnight", () => {
    expect(
      getBlockBoundaryChoices({
        date: "2026-04-05",
        minute: 90,
        timeZone: "Australia/Lord_Howe",
      }).map(({ instant, offset }) => [instant, offset]),
    ).toEqual([
      ["2026-04-04T14:30:00Z", "+11:00"],
      ["2026-04-04T15:00:00Z", "+10:30"],
    ]);
    expect(
      getBlockBoundaryChoices({
        date: "2026-11-02",
        minute: 1440,
        timeZone: "UTC",
      }),
    ).toEqual([{ instant: "2026-11-03T00:00:00Z", offset: "+00:00" }]);
  });
});
