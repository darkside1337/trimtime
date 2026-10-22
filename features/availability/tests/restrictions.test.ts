import { describe, expect, it } from "vitest";
import { resolveDateSchedule } from "../restrictions";

describe("dated schedule precedence", () => {
  const recurring = {
    working: [{ start: 540, end: 720 }],
    breaks: [{ start: 600, end: 615 }],
  };

  it("uses recurring hours and breaks when there is no dated state", () => {
    expect(resolveDateSchedule(recurring, null)).toEqual(recurring);
  });
  it("dated hours replace recurring hours and breaks", () => {
    const override = { working: [{ start: 600, end: 660 }], breaks: [] };
    expect(
      resolveDateSchedule(recurring, { override, closed: false, revision: 1 }),
    ).toEqual(override);
  });
  it("closure wins while retaining the replacement for reopening", () => {
    expect(
      resolveDateSchedule(recurring, {
        override: recurring,
        closed: true,
        revision: 1,
      }),
    ).toEqual({ working: [], breaks: [] });
  });
});
