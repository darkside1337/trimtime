import { describe, expect, it } from "vitest";
import {
  barberIdForTarget,
  isSameTarget,
  scheduleTargetFromValue,
  scheduleTargetValue,
} from "../types";

describe("schedule targets", () => {
  it("round-trips the existing select and event values", () => {
    expect(scheduleTargetFromValue("shop")).toEqual({ kind: "shop" });
    expect(scheduleTargetFromValue("barber-1")).toEqual({
      kind: "barber",
      barberId: "barber-1",
    });
    expect(scheduleTargetValue({ kind: "shop" })).toBe("shop");
    expect(scheduleTargetValue({ kind: "barber", barberId: "barber-1" })).toBe(
      "barber-1",
    );
  });

  it("compares shop and barber targets by their discriminated identity", () => {
    expect(isSameTarget({ kind: "shop" }, { kind: "shop" })).toBe(true);
    expect(
      isSameTarget(
        { kind: "barber", barberId: "barber-1" },
        { kind: "barber", barberId: "barber-1" },
      ),
    ).toBe(true);
    expect(
      isSameTarget({ kind: "shop" }, { kind: "barber", barberId: "shop" }),
    ).toBe(false);
    expect(
      isSameTarget(
        { kind: "barber", barberId: "barber-1" },
        { kind: "barber", barberId: "barber-2" },
      ),
    ).toBe(false);
  });

  it("returns a target barber only when active", () => {
    const activeBarbers = [{ id: "barber-1" }, { id: "barber-2" }];
    expect(
      barberIdForTarget(
        { kind: "barber", barberId: "barber-1" },
        activeBarbers,
      ),
    ).toBe("barber-1");
    expect(barberIdForTarget({ kind: "shop" }, activeBarbers)).toBe("");
    expect(
      barberIdForTarget(
        { kind: "barber", barberId: "archived" },
        activeBarbers,
      ),
    ).toBe("");
  });
});
