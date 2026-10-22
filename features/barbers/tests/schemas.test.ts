import { expect, it } from "vitest";
import { saveBarberSchema } from "../schemas";

const serviceId = "11111111-1111-4111-8111-111111111111";

it("trims a barber name and deduplicates service assignments", () => {
  expect(
    saveBarberSchema.parse({
      name: " Sam ",
      serviceIds: [serviceId, serviceId],
    }),
  ).toEqual({
    name: "Sam",
    serviceIds: [serviceId],
  });
});

it.each([
  { name: " ", serviceIds: [] },
  { name: "Sam", serviceIds: [], shopId: "foreign" },
  { name: "Sam", serviceIds: ["not-a-uuid"] },
])("rejects invalid barber input", (input) => {
  expect(saveBarberSchema.safeParse(input).success).toBe(false);
});
