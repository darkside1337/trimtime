import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

export function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function createBearerSecret() {
  return randomBytes(32).toString("base64url");
}

function key() {
  const encoded = process.env.BOOKING_CAPABILITY_ENCRYPTION_KEY;
  const id = process.env.BOOKING_CAPABILITY_KEY_ID;
  if (!encoded || !id)
    throw new Error("Booking capability encryption is unavailable.");
  const value = Buffer.from(encoded, "base64");
  if (value.length !== 32)
    throw new Error("Booking capability encryption is unavailable.");
  return { id, value };
}

export function encryptCapability(token: string, aad: string) {
  const { id, value } = key();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", value, iv);
  cipher.setAAD(Buffer.from(aad));
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return {
    keyId: id,
    ciphertext: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      "base64url",
    ),
  };
}

export function decryptCapability(
  ciphertext: string,
  keyId: string,
  aad: string,
) {
  const configured = key();
  if (keyId !== configured.id)
    throw new Error("Booking capability encryption is unavailable.");
  const encoded = Buffer.from(ciphertext, "base64url");
  if (encoded.length < 29) throw new Error("Invalid capability ciphertext.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    configured.value,
    encoded.subarray(0, 12),
  );
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(encoded.subarray(12, 28));
  return Buffer.concat([
    decipher.update(encoded.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}

export function canonicalManageUrl(subdomain: string, token: string) {
  const base = new URL(process.env.MARKETING_ORIGIN ?? "http://localhost:3100");
  base.hostname = `${subdomain}.${base.hostname}`;
  base.pathname = `/manage/${encodeURIComponent(token)}`;
  base.search = "";
  base.hash = "";
  return base.toString();
}
