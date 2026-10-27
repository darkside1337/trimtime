import { describe, expect, it } from "vitest";
import { fixedBookingPrice } from "../money";

describe("fixedBookingPrice", () => {
  it("pads cents without converting exact numeric strings through floating point", () => {
    expect(fixedBookingPrice("25")).toBe("25.00");
    expect(fixedBookingPrice("25.5")).toBe("25.50");
    expect(fixedBookingPrice("9007199254740993.01")).toBe(
      "9007199254740993.01",
    );
  });
});
