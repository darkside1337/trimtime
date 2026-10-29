import type { Pool } from "pg";
import { hashSecret } from "@/features/bookings/capabilities";

type RateKey = { scope: string; keyHash: string };

/**
 * Tracks the rate-limit keys a test file creates so teardown can remove only
 * its own rows. Rate events are removed by the public_rate_events foreign key
 * cascade; no shared table is truncated.
 */
export function createRateKeyTracker() {
  const keys = new Map<string, RateKey>();
  return {
    add(scope: string, rawKey: string) {
      const keyHash = hashSecret(rawKey);
      keys.set(`${scope}\u0000${keyHash}`, { scope, keyHash });
      return keyHash;
    },
    async deleteAll(pool: Pool) {
      if (keys.size === 0) return;
      const entries = [...keys.values()];
      await pool.query(
        `DELETE FROM public_rate_keys AS k
         USING unnest($1::text[], $2::text[]) AS owned(scope, key_hash)
         WHERE k.scope = owned.scope AND k.key_hash = owned.key_hash`,
        [
          entries.map((entry) => entry.scope),
          entries.map((entry) => entry.keyHash),
        ],
      );
      keys.clear();
    },
  };
}

type RateKeyTracker = ReturnType<typeof createRateKeyTracker>;

function readStringProperty(
  value: unknown,
  property: string,
): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const candidate = (value as Record<string, unknown>)[property];
  return typeof candidate === "string" ? candidate : undefined;
}

/** Tracks the create_email_shop key that createPublicBooking may record. */
export function trackCreateEmailRateKey(
  tracker: RateKeyTracker,
  context: { shopId: string } | null,
  input: unknown,
) {
  if (!context?.shopId) return;
  const contact = (input as { contact?: unknown } | null)?.contact;
  const email = readStringProperty(contact, "email");
  if (!email) return;
  tracker.add(
    "create_email_shop",
    `${context.shopId}:${email.trim().toLowerCase()}`,
  );
}

/** Tracks the customer_change_link key recorded by cancel/replace mutations. */
export function trackCustomerChangeRateKey(
  tracker: RateKeyTracker,
  context: { shopId: string } | null,
  input: unknown,
) {
  if (!context?.shopId) return;
  const token = readStringProperty(input, "token");
  if (!token) return;
  tracker.add("customer_change_link", `${context.shopId}:${token}`);
}
