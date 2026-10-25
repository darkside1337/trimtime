import { afterEach, describe, expect, it } from "vitest";
import {
  decryptCapability,
  encryptCapability,
  hashSecret,
} from "../capabilities";

const originalKey = process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY;
const originalKeyId = process.env.BOOKING_CAPABILITY_KEY_ID;

afterEach(() => {
  if (originalKey === undefined)
    delete process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY;
  else process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY = originalKey;
  if (originalKeyId === undefined) delete process.env.BOOKING_CAPABILITY_KEY_ID;
  else process.env.BOOKING_CAPABILITY_KEY_ID = originalKeyId;
});

describe("booking capability storage", () => {
  it("encrypts with fresh authenticated ciphertext bound to booking and shop", () => {
    process.env.BOOKING_CAPABILITY_KEY_ID = "test-v1";
    process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY = Buffer.alloc(
      32,
      8,
    ).toString("base64");
    const first = encryptCapability("opaque-token", "shop:booking");
    const second = encryptCapability("opaque-token", "shop:booking");
    expect(first.ciphertext).not.toBe(second.ciphertext);
    expect(
      decryptCapability(first.ciphertext, first.keyId, "shop:booking"),
    ).toBe("opaque-token");
    expect(() =>
      decryptCapability(first.ciphertext, first.keyId, "other-shop:booking"),
    ).toThrow();
  });

  it("fails closed for missing/wrong keys and tampered ciphertext", () => {
    process.env.BOOKING_CAPABILITY_KEY_ID = "test-v1";
    process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY = Buffer.alloc(
      32,
      8,
    ).toString("base64");
    const encrypted = encryptCapability("opaque-token", "shop:booking");
    const tampered = Buffer.from(encrypted.ciphertext, "base64url");
    tampered[tampered.length - 1] ^= 1;
    expect(() =>
      decryptCapability(encrypted.ciphertext, "wrong-key", "shop:booking"),
    ).toThrow();
    expect(() =>
      decryptCapability(
        tampered.toString("base64url"),
        encrypted.keyId,
        "shop:booking",
      ),
    ).toThrow();
    delete process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY;
    expect(() => encryptCapability("opaque-token", "shop:booking")).toThrow();
  });

  it("stores a one-way lookup hash", () => {
    expect(hashSecret("opaque-token")).toHaveLength(64);
    expect(hashSecret("opaque-token")).not.toBe("opaque-token");
  });
});
