import { expect, it } from "vitest";
import { saveServiceSchema } from "../schemas";

const barberId = "11111111-1111-4111-8111-111111111111";

it("accepts a free 35-minute service without assigning barbers", () => {
  const result = saveServiceSchema.safeParse({
    name: " Community cut ",
    priceUsd: "0",
    durationMinutes: "35",
    offered: true,
    barberIds: [],
  });

  expect(result).toEqual({
    success: true,
    data: {
      name: "Community cut",
      priceUsd: "0.00",
      durationMinutes: "35",
      offered: true,
      barberIds: [],
    },
  });
});

it.each([
  ["12", "12.00"],
  ["12.5", "12.50"],
  ["0012.50", "12.50"],
])("canonicalizes the accepted USD amount %s", (priceUsd, expected) => {
  const result = saveServiceSchema.safeParse({
    name: "Trim",
    priceUsd,
    durationMinutes: "030",
    offered: true,
    barberIds: [],
  });

  expect(result).toMatchObject({
    success: true,
    data: { priceUsd: expected, durationMinutes: "30" },
  });
});

it.each(["-0.01", "1.001", "1.000", ".50", "12.", "+12", "1e2", "1,000"])(
  "rejects unsupported USD input %s",
  (priceUsd) => {
    expect(
      saveServiceSchema.safeParse({
        name: "Trim",
        priceUsd,
        durationMinutes: "30",
        offered: true,
        barberIds: [],
      }).success,
    ).toBe(false);
  },
);

it.each(["29", "30.5", "35.0", "3e1", ""])(
  "rejects invalid duration input %s",
  (durationMinutes) => {
    expect(
      saveServiceSchema.safeParse({
        name: "Trim",
        priceUsd: "12",
        durationMinutes,
        offered: true,
        barberIds: [],
      }).success,
    ).toBe(false);
  },
);

it("trims and requires a name, rejects authority fields, and deduplicates assignments", () => {
  expect(
    saveServiceSchema.safeParse({
      name: "  ",
      priceUsd: "12",
      durationMinutes: "30",
      offered: true,
      barberIds: [],
    }).success,
  ).toBe(false);
  expect(
    saveServiceSchema.safeParse({
      name: "Trim",
      priceUsd: "12",
      durationMinutes: "30",
      offered: true,
      barberIds: [barberId, barberId],
      shopId: "foreign-shop",
    }).success,
  ).toBe(false);
  expect(
    saveServiceSchema.parse({
      name: " Trim ",
      priceUsd: "12",
      durationMinutes: "30",
      offered: true,
      barberIds: [barberId, barberId],
    }),
  ).toMatchObject({ name: "Trim", barberIds: [barberId] });
});
