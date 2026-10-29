import { describe, expect, it } from "vitest";
import {
  cancelCustomerBookingSchema,
  publicBookingContactSchema,
} from "../schemas";

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

describe("customer cancellation input", () => {
  const valid = {
    token: "t".repeat(43),
    expectedRevision: 0,
    operationKey: "k".repeat(43),
    confirmed: true as const,
  };

  it("accepts an explicit confirmation with revision zero and a fresh operation key", () => {
    expect(cancelCustomerBookingSchema.parse(valid)).toEqual(valid);
  });

  it("rejects unconfirmed, missing, and non-literal confirmation values", () => {
    const withoutConfirmation = {
      token: valid.token,
      expectedRevision: valid.expectedRevision,
      operationKey: valid.operationKey,
    };
    for (const invalid of [
      { ...valid, confirmed: false },
      { ...valid, confirmed: "true" },
      withoutConfirmation,
    ]) {
      expect(cancelCustomerBookingSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it("preserves a whitespace-padded capability token byte for byte", () => {
    const padded = `  ${valid.token}\t`;

    expect(
      cancelCustomerBookingSchema.parse({ ...valid, token: padded }).token,
    ).toBe(padded);
  });

  it("rejects malformed revision, token, operation key, and non-object input", () => {
    for (const invalid of [
      { ...valid, expectedRevision: -1 },
      { ...valid, expectedRevision: 0.5 },
      { ...valid, token: "" },
      { ...valid, operationKey: "k".repeat(42) },
      { ...valid, operationKey: "!".repeat(43) },
      null,
      "not-an-object",
      42,
      [],
    ]) {
      expect(cancelCustomerBookingSchema.safeParse(invalid).success).toBe(
        false,
      );
    }
  });

  it("rejects caller-supplied shop, booking, and actor authority", () => {
    for (const extra of [
      { shopId: "foreign-shop" },
      { bookingId: "123e4567-e89b-42d3-a456-426614174000" },
      { actorId: "foreign-owner" },
      { actorType: "customer" },
    ]) {
      expect(
        cancelCustomerBookingSchema.safeParse({ ...valid, ...extra }).success,
      ).toBe(false);
    }
  });
});
