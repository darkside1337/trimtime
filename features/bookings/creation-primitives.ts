import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema/bookings";
import { barberServices, barbers, services } from "@/db/schema/catalog";
import { notificationWork } from "@/db/schema/notification-work";
import { occupiedIntervals } from "@/db/schema/occupancy";
import { shops } from "@/db/schema/shops";
import { notificationContentIdentity } from "@/features/notifications/content-identity";
import {
  createBearerSecret,
  decryptCapability,
  encryptCapability,
  hashSecret,
} from "./capabilities";
import { fixedBookingPrice } from "./money";

export type BookingTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export type CreationReplay =
  | { status: "none" }
  | { status: "mismatch" }
  | { status: "matched"; bookingId: string; token: string };

export async function findCreationReplay(
  tx: BookingTransaction,
  params: {
    shopId: string;
    creationSource: "public" | "owner";
    recoveryKey: string;
    payloadDigest: string;
    now: Date;
  },
): Promise<CreationReplay> {
  const keyHash = hashSecret(params.recoveryKey);
  const result = await tx.execute(
    sql`SELECT id, recovery_payload_digest, capability_hash, capability_ciphertext, capability_key_id, capability_revoked_at, end_at FROM bookings WHERE shop_id = ${params.shopId} AND creation_source=${params.creationSource} AND recovery_key_hash = ${keyHash} LIMIT 1`,
  );
  const row = result.rows[0] as
    | {
        id: string;
        recovery_payload_digest: string;
        capability_hash: string;
        capability_ciphertext: string;
        capability_key_id: string;
        capability_revoked_at: Date | null;
        end_at: Date;
      }
    | undefined;
  if (!row) {
    const collision = await tx.execute(
      sql`SELECT id FROM bookings WHERE shop_id=${params.shopId} AND recovery_key_hash=${keyHash} LIMIT 1`,
    );
    return collision.rows.length ? { status: "mismatch" } : { status: "none" };
  }
  if (
    row.recovery_payload_digest !== params.payloadDigest ||
    row.capability_revoked_at ||
    params.now.getTime() >= new Date(row.end_at).getTime() + 168 * 60 * 60_000
  )
    return { status: "mismatch" };
  try {
    const token = decryptCapability(
      row.capability_ciphertext,
      row.capability_key_id,
      `${params.shopId}:${row.id}`,
    );
    if (hashSecret(token) !== row.capability_hash)
      return { status: "mismatch" };
    return { status: "matched", bookingId: row.id, token };
  } catch {
    return { status: "mismatch" };
  }
}

export type CreationOffer =
  | {
      ok: true;
      service: typeof services.$inferSelect;
      barber: typeof barbers.$inferSelect;
    }
  | { ok: false; reason: "unavailable" | "changed" };

export async function resolveCreationOffer(
  tx: BookingTransaction,
  params: {
    shopId: string;
    serviceId: string;
    barberId: string;
    reviewedOffer: {
      name: string;
      priceUsd: string;
      durationMinutes: string;
    };
  },
): Promise<CreationOffer> {
  const [service] = await tx
    .select()
    .from(services)
    .where(
      and(
        eq(services.shopId, params.shopId),
        eq(services.id, params.serviceId),
      ),
    )
    .limit(1);
  const [barber] = await tx
    .select()
    .from(barbers)
    .where(
      and(eq(barbers.shopId, params.shopId), eq(barbers.id, params.barberId)),
    )
    .limit(1);
  const [assignment] = await tx
    .select({ barberId: barberServices.barberId })
    .from(barberServices)
    .where(
      and(
        eq(barberServices.shopId, params.shopId),
        eq(barberServices.serviceId, params.serviceId),
        eq(barberServices.barberId, params.barberId),
      ),
    )
    .limit(1);
  if (
    !service ||
    !barber ||
    !assignment ||
    service.archived ||
    !service.offered ||
    barber.archived
  )
    return { ok: false, reason: "unavailable" };
  if (
    service.name !== params.reviewedOffer.name ||
    fixedBookingPrice(service.priceUsd) !== params.reviewedOffer.priceUsd ||
    String(service.durationMinutes) !== params.reviewedOffer.durationMinutes
  )
    return { ok: false, reason: "changed" };
  return { ok: true, service, barber };
}

export async function findOccupyingInterval(
  tx: BookingTransaction,
  params: {
    shopId: string;
    barberId: string;
    start: Date;
    end: Date;
    excludeOccupancyId?: string;
  },
): Promise<string | undefined> {
  const [overlap] = await tx
    .select({ id: occupiedIntervals.id })
    .from(occupiedIntervals)
    .where(
      and(
        eq(occupiedIntervals.shopId, params.shopId),
        eq(occupiedIntervals.barberId, params.barberId),
        params.excludeOccupancyId
          ? sql`${occupiedIntervals.id} <> ${params.excludeOccupancyId}`
          : sql`true`,
        sql`${occupiedIntervals.startAt} < ${params.end}`,
        sql`${occupiedIntervals.endAt} > ${params.start}`,
      ),
    )
    .limit(1);
  return overlap?.id;
}

type CreationNotification = {
  kind: "customer_confirmation" | "owner_alert";
  channel: "email" | "whatsapp";
  status: "unavailable" | "not_attempted" | "skipped";
  recipient: string | null;
  reason: string | null;
};

type CreationPersistence = {
  shop: { id: string; timeZoneLockedAt: Date | null };
  service: typeof services.$inferSelect;
  barber: typeof barbers.$inferSelect;
  start: Date;
  end: Date;
  durationMinutes: number;
  contact: {
    name: string;
    email: string | null;
    phone: string | null;
    whatsappOptIn: boolean;
  };
  creationSource: "public" | "owner";
  recoveryKey: string;
  payloadDigest: string;
  notifications: CreationNotification[];
  now: Date;
};

/**
 * Persists the reservation, capability, notification work, and first zone lock.
 * Callers keep source-specific replay, validation, scheduling, receipt, and
 * notification-channel policy around this shared transaction step.
 */
export async function persistBookingCreation(
  tx: BookingTransaction,
  params: CreationPersistence,
): Promise<{ bookingId: string; token: string }> {
  const bookingId = randomUUID();
  const occupancyId = randomUUID();
  const token = createBearerSecret();
  const encrypted = encryptCapability(token, `${params.shop.id}:${bookingId}`);
  const consentAt = params.contact.whatsappOptIn ? params.now : null;
  await tx.insert(occupiedIntervals).values({
    id: occupancyId,
    shopId: params.shop.id,
    barberId: params.barber.id,
    startAt: params.start,
    endAt: params.end,
  });
  await tx.insert(bookings).values({
    id: bookingId,
    shopId: params.shop.id,
    serviceId: params.service.id,
    barberId: params.barber.id,
    occupancyId,
    status: "confirmed",
    startAt: params.start,
    endAt: params.end,
    serviceName: params.service.name,
    servicePriceUsd: params.service.priceUsd,
    serviceDurationMinutes: params.durationMinutes,
    barberName: params.barber.name,
    customerName: params.contact.name,
    customerEmail: params.contact.email,
    customerPhone: params.contact.phone,
    whatsappOptIn: params.contact.whatsappOptIn,
    whatsappConsentAt: consentAt,
    createdAt: params.now,
    capabilityHash: hashSecret(token),
    capabilityCiphertext: encrypted.ciphertext,
    capabilityKeyId: encrypted.keyId,
    recoveryKeyHash: hashSecret(params.recoveryKey),
    recoveryPayloadDigest: params.payloadDigest,
    creationSource: params.creationSource,
  });
  const contentIdentity = notificationContentIdentity({
    id: bookingId,
    startAt: params.start,
    endAt: params.end,
    serviceName: params.service.name,
    servicePriceUsd: params.service.priceUsd,
    serviceDurationMinutes: params.durationMinutes,
    barberName: params.barber.name,
    customerName: params.contact.name,
    customerEmail: params.contact.email,
    customerPhone: params.contact.phone,
  });
  await tx.insert(notificationWork).values(
    params.notifications.map((notification) => ({
      id: randomUUID(),
      bookingId,
      contentIdentity,
      ...notification,
    })),
  );
  if (!params.shop.timeZoneLockedAt)
    await tx
      .update(shops)
      .set({ timeZoneLockedAt: params.now })
      .where(eq(shops.id, params.shop.id));
  return { bookingId, token };
}
