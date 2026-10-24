import { describe, expect, it } from "vitest";
import {
  createShopSchema,
  shopPublicationSchema,
  updateShopSchema,
} from "../schemas";

describe("shop setup input", () => {
  it("accepts the required details of a fictional draft shop", () => {
    const result = createShopSchema.safeParse({
      name: "Juniper Barber",
      subdomain: "juniper",
      timeZone: "America/New_York",
      publicContact: "Call 202-555-0142",
      address: "123 Example Street",
    });

    expect(result.success).toBe(true);
  });

  it("rejects missing and blank required text", () => {
    for (const input of [
      {
        subdomain: "juniper",
        timeZone: "UTC",
        publicContact: "Call",
        address: "1 Main",
      },
      {
        name: " ",
        subdomain: "juniper",
        timeZone: "UTC",
        publicContact: "Call",
        address: "1 Main",
      },
      {
        name: "Juniper",
        subdomain: "juniper",
        timeZone: "UTC",
        publicContact: "  ",
        address: "1 Main",
      },
      {
        name: "Juniper",
        subdomain: "juniper",
        timeZone: "UTC",
        publicContact: "Call",
        address: "\t",
      },
    ]) {
      expect(createShopSchema.safeParse(input).success).toBe(false);
    }
  });

  it("accepts IANA time zones and rejects invalid zones", () => {
    for (const timeZone of ["America/New_York", "UTC"]) {
      expect(
        createShopSchema.safeParse({
          name: "Juniper",
          subdomain: "juniper",
          timeZone,
          publicContact: "Call",
          address: "1 Main",
        }).success,
      ).toBe(true);
    }

    for (const timeZone of ["-05:00", "not-a-zone"]) {
      expect(
        createShopSchema.safeParse({
          name: "Juniper",
          subdomain: "juniper",
          timeZone,
          publicContact: "Call",
          address: "1 Main",
        }).success,
      ).toBe(false);
    }
  });

  it("normalizes a valid subdomain", () => {
    const result = createShopSchema.safeParse({
      name: "Juniper",
      subdomain: " JUNIPER-2 ",
      timeZone: "UTC",
      publicContact: "Call",
      address: "1 Main",
    });

    expect(result.success && result.data.subdomain).toBe("juniper-2");
  });

  it("accepts only an approved DNS-label subdomain", () => {
    const input = {
      name: "Juniper",
      timeZone: "UTC",
      publicContact: "Call",
      address: "1 Main",
    };
    for (const subdomain of ["a", "a".repeat(63)]) {
      expect(createShopSchema.safeParse({ ...input, subdomain }).success).toBe(
        true,
      );
    }
    for (const subdomain of [
      "",
      "a".repeat(64),
      "-start",
      "end-",
      "has.dot",
      "under_score",
      "café",
    ]) {
      expect(createShopSchema.safeParse({ ...input, subdomain }).success).toBe(
        false,
      );
    }
  });

  it("rejects reserved subdomains after normalization", () => {
    const input = {
      name: "Juniper",
      timeZone: "UTC",
      publicContact: "Call",
      address: "1 Main",
    };
    for (const subdomain of ["app", " www ", "API", "admin"]) {
      expect(createShopSchema.safeParse({ ...input, subdomain }).success).toBe(
        false,
      );
    }
  });

  it("rejects client-supplied authority and shop fields", () => {
    const result = createShopSchema.safeParse({
      name: "Juniper",
      subdomain: "juniper",
      timeZone: "UTC",
      publicContact: "Call",
      address: "1 Main",
      ownerId: "attacker",
      shopId: "attacker-shop",
      published: true,
      role: "owner",
    });

    expect(result.success).toBe(false);
  });

  it("accepts editable pre-booking settings", () => {
    expect(
      updateShopSchema.safeParse({
        name: "Updated Juniper",
        publicContact: "Email hello@example.test",
        timeZone: "UTC",
      }).success,
    ).toBe(true);
  });

  it("requires explicit desired publication state and rejects authority fields", () => {
    expect(
      shopPublicationSchema.safeParse({
        published: true,
        expectedPublished: false,
      }).success,
    ).toBe(true);
    for (const input of [
      { published: true },
      { published: "true", expectedPublished: false },
      { published: true, expectedPublished: false, shopId: "foreign" },
    ])
      expect(shopPublicationSchema.safeParse(input).success).toBe(false);
  });
});
