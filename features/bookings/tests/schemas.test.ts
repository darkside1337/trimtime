import { expect, it } from "vitest";
import { publicBookingContactSchema } from "../schemas";

it("requires a phone when WhatsApp consent is selected", () => {
  const result = publicBookingContactSchema.safeParse({
    name: "Ada",
    email: "ada@example.test",
    whatsappOptIn: true,
  });

  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues.some((issue) => issue.path[0] === "phone")).toBe(
      true,
    );
  }
});

it.each(["", "   "])("rejects a whitespace-only phone (%j)", (phone) => {
  expect(
    publicBookingContactSchema.safeParse({
      name: "Ada",
      email: "ada@example.test",
      phone,
      whatsappOptIn: false,
    }).success,
  ).toBe(false);
});

it("trims the name and optional phone and normalizes email", () => {
  expect(
    publicBookingContactSchema.parse({
      name: " Ada Lovelace ",
      email: " ADA@EXAMPLE.TEST ",
      phone: " +1 555 0100 ",
      whatsappOptIn: false,
    }),
  ).toEqual({
    name: "Ada Lovelace",
    email: "ada@example.test",
    phone: "+1 555 0100",
    whatsappOptIn: false,
  });
});

it.each([
  { email: "ada@example.test", whatsappOptIn: false },
  { name: "Ada", whatsappOptIn: false },
  { name: "Ada", email: "bad", whatsappOptIn: false },
  { name: "Ada", email: "ada@example.test" },
  { name: "Ada", email: "ada@example.test", whatsappOptIn: "yes" },
])("rejects invalid or missing contact fields: %j", (contact) => {
  expect(publicBookingContactSchema.safeParse(contact).success).toBe(false);
});

it("accepts email-only contact and requires phone only with explicit consent", () => {
  expect(
    publicBookingContactSchema.parse({
      name: "Ada",
      email: "ada@example.test",
      whatsappOptIn: false,
    }),
  ).toEqual({ name: "Ada", email: "ada@example.test", whatsappOptIn: false });
  expect(
    publicBookingContactSchema.parse({
      name: "Ada",
      email: "ada@example.test",
      phone: "+1 555 0100",
      whatsappOptIn: true,
    }).whatsappOptIn,
  ).toBe(true);
});
