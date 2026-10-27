import "server-only";
import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  barberDateSchedules,
  barberSchedules,
  shopDateSchedules,
  shopSchedules,
} from "@/db/schema/availability";
import { barberServices, barbers, services } from "@/db/schema/catalog";
import { bookings } from "@/db/schema/bookings";
import { notificationWork } from "@/db/schema/notification-work";
import { resolveEmailConfig } from "@/features/notifications/config";
import { notificationContentIdentity } from "@/features/notifications/content-identity";
import { customerEmailSummary } from "@/features/notifications/customer-summary";
import { publicRateEvents, publicRateKeys } from "@/db/schema/public-limits";
import { occupiedIntervals } from "@/db/schema/occupancy";
import { shops } from "@/db/schema/shops";
import type { ActionResult } from "@/lib/action-result";
import {
  calculateSlots,
  fitsScheduleInterval,
} from "@/features/availability/slots";
import { resolveDateSchedule } from "@/features/availability/restrictions";
import type { WeeklySchedule } from "@/features/availability/types";
import { createOwnerBookingSchema, createPublicBookingSchema } from "./schemas";
import { fixedBookingPrice } from "./money";
import {
  canonicalManageUrl,
  createBearerSecret,
  decryptCapability,
  encryptCapability,
  hashSecret,
} from "./capabilities";
import type {
  BookingFailureCode,
  ManagedBookingView,
  PublicBookingContext,
  PublicBookingInput,
  PublicBookingReceipt,
  OwnerBookingReceipt,
} from "./types";
import type { OwnerContext } from "@/server/owner-context";
import { getOwnAppointment } from "./queries";

function failure(
  code: BookingFailureCode,
  message: string,
): ActionResult<PublicBookingReceipt> {
  return { success: false, error: { code, message } };
}

function payloadDigest(
  input: ReturnType<typeof createPublicBookingSchema.parse>,
) {
  return hashSecret(
    JSON.stringify({
      serviceId: input.serviceId,
      barberId: input.barberId,
      startAt: new Date(input.startAt).toISOString(),
      reviewedOffer: input.reviewedOffer,
      contact: input.contact,
    }),
  );
}

async function rateEvent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  scope: string,
  rawKey: string,
  now: Date,
  limit: number,
) {
  const keyHash = hashSecret(rawKey);
  await tx
    .insert(publicRateKeys)
    .values({ scope, keyHash })
    .onConflictDoNothing();
  await tx.execute(
    sql`SELECT scope FROM public_rate_keys WHERE scope = ${scope} AND key_hash = ${keyHash} FOR UPDATE`,
  );
  await tx
    .insert(publicRateEvents)
    .values({ id: randomUUID(), scope, keyHash, createdAt: now });
  const result = await tx.execute(
    sql`SELECT count(*)::int AS count FROM public_rate_events WHERE scope = ${scope} AND key_hash = ${keyHash} AND created_at > ${new Date(now.getTime() - 60 * 60_000)}`,
  );
  return Number(result.rows[0]?.count ?? 0) <= limit;
}

function savedView(
  row: {
    status: "confirmed" | "cancelled";
    startAt: Date | string;
    endAt: Date | string;
    serviceName: string;
    servicePriceUsd: string;
    serviceDurationMinutes: number;
    barberName: string;
    customerName: string;
    customerEmail: string | null;
    customerPhone: string | null;
    whatsappOptIn: boolean;
    shopName: string;
    publicContact: string;
    address: string;
    timeZone: string;
    notifications: ManagedBookingView["notifications"];
  },
  now: Date,
): ManagedBookingView {
  const startAt = new Date(row.startAt);
  const endAt = new Date(row.endAt);
  return {
    status: row.status,
    startAt: startAt.toISOString(),
    endAt: endAt.toISOString(),
    service: {
      name: row.serviceName,
      priceUsd: row.servicePriceUsd,
      durationMinutes: row.serviceDurationMinutes,
    },
    barber: { name: row.barberName },
    customer: {
      name: row.customerName,
      email: row.customerEmail,
      phone: row.customerPhone,
      whatsappOptIn: row.whatsappOptIn,
    },
    shop: {
      name: row.shopName,
      publicContact: row.publicContact,
      address: row.address,
      timeZone: row.timeZone,
    },
    notifications: row.notifications,
    past: endAt.getTime() <= now.getTime(),
    changeCutoffPassed:
      row.status !== "confirmed" ||
      startAt.getTime() - now.getTime() < 12 * 60 * 60_000,
  };
}

async function receiptFor(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  bookingId: string,
  manageUrl: string,
  now: Date,
): Promise<PublicBookingReceipt | null> {
  const result = await tx.execute(
    sql`SELECT b.id, b.status, b.start_at AS "startAt", b.end_at AS "endAt", b.service_name AS "serviceName", b.service_price_usd AS "servicePriceUsd", b.service_duration_minutes AS "serviceDurationMinutes", b.barber_name AS "barberName", b.customer_name AS "customerName", b.customer_email AS "customerEmail", b.customer_phone AS "customerPhone", b.whatsapp_opt_in AS "whatsappOptIn", s.name AS "shopName", s.public_contact AS "publicContact", s.address AS "address", s.time_zone AS "timeZone", w.status AS "emailStatus", w.reason AS "emailReason", w.claimed_at AS "emailClaimedAt", w.updated_at AS "emailUpdatedAt"
      FROM bookings b JOIN shops s ON s.id = b.shop_id LEFT JOIN notification_work w ON w.booking_id=b.id AND w.kind='customer_confirmation' AND w.channel='email' WHERE b.id = ${bookingId}`,
  );
  const row = result.rows[0] as
    | (Parameters<typeof savedView>[0] & {
        id: string;
        emailStatus:
          PublicBookingReceipt["notifications"]["email"]["status"] | null;
        emailReason: string | null;
        emailClaimedAt: Date | null;
        emailUpdatedAt: Date | null;
      })
    | undefined;
  if (!row) return null;
  const email = customerEmailSummary(
    {
      status: row.emailStatus,
      reason: row.emailReason,
      claimedAt: row.emailClaimedAt,
      updatedAt: row.emailUpdatedAt,
    },
    now,
  );
  return {
    bookingId: row.id,
    manageUrl,
    booking: savedView({ ...row, notifications: { email } }, now),
    notifications: {
      email,
      whatsapp: "unavailable",
    },
  };
}

async function recoverExisting(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  shopId: string,
  recoveryKey: string,
  digest: string,
  now: Date,
) {
  const keyHash = hashSecret(recoveryKey);
  const result = await tx.execute(
    sql`SELECT id, recovery_payload_digest, capability_hash, capability_ciphertext, capability_key_id, capability_revoked_at, end_at FROM bookings WHERE shop_id = ${shopId} AND creation_source='public' AND recovery_key_hash = ${keyHash} LIMIT 1`,
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
      sql`SELECT id FROM bookings WHERE shop_id=${shopId} AND recovery_key_hash=${keyHash} LIMIT 1`,
    );
    return collision.rows.length
      ? { found: true as const, receipt: null }
      : { found: false as const };
  }
  if (
    row.recovery_payload_digest !== digest ||
    row.capability_revoked_at ||
    now.getTime() >= new Date(row.end_at).getTime() + 168 * 60 * 60_000
  )
    return { found: true as const, receipt: null };
  try {
    const token = decryptCapability(
      row.capability_ciphertext,
      row.capability_key_id,
      `${shopId}:${row.id}`,
    );
    if (hashSecret(token) !== row.capability_hash)
      return { found: true as const, receipt: null };
    const receipt = await receiptFor(tx, row.id, "", now);
    if (!receipt) return { found: true as const, receipt: null };
    const shop = await tx
      .select({ subdomain: shops.subdomain })
      .from(shops)
      .where(eq(shops.id, shopId))
      .limit(1);
    receipt.manageUrl = canonicalManageUrl(shop[0].subdomain, token);
    return { found: true as const, receipt };
  } catch {
    return { found: true as const, receipt: null };
  }
}

export async function createPublicBooking(
  context: PublicBookingContext | null,
  input: PublicBookingInput | unknown,
): Promise<ActionResult<PublicBookingReceipt>> {
  if (!context?.shopId)
    return failure("UNAVAILABLE", "Booking is unavailable.");
  const parsed = createPublicBookingSchema.safeParse(input);
  if (!parsed.success)
    return failure(
      "VALIDATION_ERROR",
      "Check the booking details and try again.",
    );
  const now = new Date();
  const digest = payloadDigest(parsed.data);
  const emailConfig = resolveEmailConfig(process.env);
  try {
    return await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT s.id, s.name, s.subdomain, s.public_contact, s.time_zone, s.published, s.time_zone_locked_at, u.email AS owner_email FROM shops s JOIN "user" u ON u.id = s.owner_id WHERE s.id = ${context.shopId} FOR UPDATE OF s`,
      );
      const shop = locked.rows[0] as
        | {
            id: string;
            name: string;
            subdomain: string;
            public_contact: string;
            time_zone: string;
            published: boolean;
            time_zone_locked_at: Date | null;
            owner_email: string;
          }
        | undefined;
      if (!shop || !shop.published)
        return failure(
          "SHOP_PAUSED",
          "This shop is not accepting bookings right now.",
        );

      const recovered = await recoverExisting(
        tx,
        shop.id,
        parsed.data.recoveryKey,
        digest,
        now,
      );
      if (recovered.found)
        return recovered.receipt
          ? { success: true, data: recovered.receipt }
          : failure(
              "RECOVERY_MISMATCH",
              "This booking attempt cannot be recovered.",
            );

      const emailAllowed = await rateEvent(
        tx,
        "create_email_shop",
        `${shop.id}:${parsed.data.contact.email}`,
        now,
        3,
      );
      if (!emailAllowed)
        return failure(
          "RATE_LIMITED",
          "Too many booking attempts. Please wait before trying again.",
        );
      const [service] = await tx
        .select()
        .from(services)
        .where(
          and(
            eq(services.shopId, shop.id),
            eq(services.id, parsed.data.serviceId),
          ),
        )
        .limit(1);
      const [barber] = await tx
        .select()
        .from(barbers)
        .where(
          and(
            eq(barbers.shopId, shop.id),
            eq(barbers.id, parsed.data.barberId),
          ),
        )
        .limit(1);
      const [assignment] = await tx
        .select({ barberId: barberServices.barberId })
        .from(barberServices)
        .where(
          and(
            eq(barberServices.shopId, shop.id),
            eq(barberServices.serviceId, parsed.data.serviceId),
            eq(barberServices.barberId, parsed.data.barberId),
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
        return failure(
          "STALE_OFFER",
          "That service or barber is no longer available. Review the current options.",
        );
      if (
        service.name !== parsed.data.reviewedOffer.name ||
        fixedBookingPrice(service.priceUsd) !==
          parsed.data.reviewedOffer.priceUsd ||
        String(service.durationMinutes) !==
          parsed.data.reviewedOffer.durationMinutes
      )
        return failure(
          "STALE_OFFER",
          "The service details changed. Review the current price and duration.",
        );
      const duration = Number(service.durationMinutes);
      if (!Number.isSafeInteger(duration))
        return failure(
          "UNAVAILABLE_INTERVAL",
          "Choose another available time.",
        );
      const start = new Date(parsed.data.startAt);
      const end = new Date(start.getTime() + duration * 60_000);
      const localDate = Temporal.Instant.from(start.toISOString())
        .toZonedDateTimeISO(shop.time_zone)
        .toPlainDate();
      const [shopWeek] = await tx
        .select({ week: shopSchedules.week })
        .from(shopSchedules)
        .where(eq(shopSchedules.shopId, shop.id))
        .limit(1);
      const [barberWeek] = await tx
        .select({ week: barberSchedules.week })
        .from(barberSchedules)
        .where(
          and(
            eq(barberSchedules.shopId, shop.id),
            eq(barberSchedules.barberId, barber.id),
          ),
        )
        .limit(1);
      if (!shopWeek || !barberWeek)
        return failure(
          "UNAVAILABLE_INTERVAL",
          "Choose another available time.",
        );
      const [shopException] = await tx
        .select()
        .from(shopDateSchedules)
        .where(
          and(
            eq(shopDateSchedules.shopId, shop.id),
            eq(shopDateSchedules.date, localDate.toString()),
          ),
        )
        .limit(1);
      const [barberException] = await tx
        .select()
        .from(barberDateSchedules)
        .where(
          and(
            eq(barberDateSchedules.shopId, shop.id),
            eq(barberDateSchedules.barberId, barber.id),
            eq(barberDateSchedules.date, localDate.toString()),
          ),
        )
        .limit(1);
      const weekday = localDate.dayOfWeek - 1;
      const shopDay = resolveDateSchedule(
        (shopWeek.week as WeeklySchedule)[weekday],
        shopException
          ? {
              override: shopException.override,
              closed: shopException.closed,
              revision: shopException.revision,
            }
          : null,
      );
      const barberDay = resolveDateSchedule(
        (barberWeek.week as WeeklySchedule)[weekday],
        barberException
          ? {
              override: barberException.override,
              closed: barberException.closed,
              revision: barberException.revision,
            }
          : null,
      );
      const occupied = await tx
        .select({
          start: occupiedIntervals.startAt,
          end: occupiedIntervals.endAt,
        })
        .from(occupiedIntervals)
        .where(
          and(
            eq(occupiedIntervals.shopId, shop.id),
            eq(occupiedIntervals.barberId, barber.id),
            sql`${occupiedIntervals.startAt} < ${end}`,
            sql`${occupiedIntervals.endAt} > ${start}`,
          ),
        );
      const slots = calculateSlots({
        date: localDate.toString(),
        timeZone: shop.time_zone,
        now: now.toISOString(),
        durationMinutes: duration,
        shopDay,
        barberDay,
        occupied: occupied.map((interval) => ({
          start: interval.start.toISOString(),
          end: interval.end.toISOString(),
        })),
      });
      if (!slots.some((slot) => Date.parse(slot.start) === start.getTime()))
        return failure(
          "UNAVAILABLE_INTERVAL",
          "Choose another available time.",
        );

      const bookingId = randomUUID();
      const occupancyId = randomUUID();
      const token = createBearerSecret();
      const encrypted = encryptCapability(token, `${shop.id}:${bookingId}`);
      const consentAt = parsed.data.contact.whatsappOptIn ? now : null;
      await tx.insert(occupiedIntervals).values({
        id: occupancyId,
        shopId: shop.id,
        barberId: barber.id,
        startAt: start,
        endAt: end,
      });
      await tx.insert(bookings).values({
        id: bookingId,
        shopId: shop.id,
        serviceId: service.id,
        barberId: barber.id,
        occupancyId,
        status: "confirmed",
        startAt: start,
        endAt: end,
        serviceName: service.name,
        servicePriceUsd: service.priceUsd,
        serviceDurationMinutes: duration,
        barberName: barber.name,
        customerName: parsed.data.contact.name,
        customerEmail: parsed.data.contact.email,
        customerPhone: parsed.data.contact.phone ?? null,
        whatsappOptIn: parsed.data.contact.whatsappOptIn,
        whatsappConsentAt: consentAt,
        createdAt: now,
        capabilityHash: hashSecret(token),
        capabilityCiphertext: encrypted.ciphertext,
        capabilityKeyId: encrypted.keyId,
        recoveryKeyHash: hashSecret(parsed.data.recoveryKey),
        recoveryPayloadDigest: digest,
      });
      const contentIdentity = notificationContentIdentity({
        id: bookingId,
        startAt: start,
        endAt: end,
        serviceName: service.name,
        servicePriceUsd: service.priceUsd,
        serviceDurationMinutes: duration,
        barberName: barber.name,
        customerName: parsed.data.contact.name,
        customerEmail: parsed.data.contact.email,
        customerPhone: parsed.data.contact.phone ?? null,
      });
      const work: (typeof notificationWork.$inferInsert)[] = [
        {
          id: randomUUID(),
          bookingId,
          kind: "customer_confirmation",
          channel: "email",
          status:
            emailConfig.mode === "mailpit" ? "not_attempted" : "unavailable",
          recipient: parsed.data.contact.email,
          contentIdentity,
          reason: emailConfig.mode === "mailpit" ? null : emailConfig.reason,
        },
        {
          id: randomUUID(),
          bookingId,
          kind: "owner_alert",
          channel: "email",
          status:
            emailConfig.mode === "mailpit" ? "not_attempted" : "unavailable",
          recipient: shop.owner_email,
          contentIdentity,
          reason: emailConfig.mode === "mailpit" ? null : emailConfig.reason,
        },
      ];
      if (parsed.data.contact.whatsappOptIn)
        work.push({
          id: randomUUID(),
          bookingId,
          kind: "customer_confirmation",
          channel: "whatsapp",
          status: "unavailable",
          recipient: parsed.data.contact.phone ?? null,
          contentIdentity,
          reason: "channel_unavailable",
        });
      await tx.insert(notificationWork).values(work);
      if (!shop.time_zone_locked_at)
        await tx
          .update(shops)
          .set({ timeZoneLockedAt: now })
          .where(eq(shops.id, shop.id));
      const receipt = await receiptFor(
        tx,
        bookingId,
        canonicalManageUrl(shop.subdomain, token),
        now,
      );
      return receipt
        ? { success: true as const, data: receipt }
        : failure("UNAVAILABLE", "Booking could not be completed.");
    });
  } catch (error) {
    const cause =
      error instanceof Error && error.cause && typeof error.cause === "object"
        ? error.cause
        : error;
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23P01"
    )
      return failure(
        "UNAVAILABLE_INTERVAL",
        "That time was just taken. Choose another available time.",
      );
    return failure(
      "UNAVAILABLE",
      "Booking is temporarily unavailable. Please try again later.",
    );
  }
}

export async function createOwnerBooking(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<OwnerBookingReceipt>> {
  const unavailable = (code: string, message: string) => ({
    success: false as const,
    error: { code, message },
  });
  if (!context?.userId)
    return unavailable("UNAUTHENTICATED", "Sign in to create appointments.");
  const parsed = createOwnerBookingSchema.safeParse(input);
  if (!parsed.success) {
    const fieldMap: Record<string, string> = {
      "contact.name": "customerName",
      "contact.email": "email",
      "contact.phone": "phone",
      serviceId: "serviceId",
      barberId: "barberId",
      startAt: "time",
    };
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of parsed.error.issues) {
      const key = fieldMap[issue.path.join(".")] ?? "form";
      fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
    }
    return {
      ...unavailable(
        "VALIDATION_ERROR",
        "Check the highlighted fields and try again.",
      ),
      fieldErrors,
    };
  }
  const emailConfig = resolveEmailConfig(process.env);
  let bookingId: string;
  try {
    const result = await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT s.id,s.name,s.subdomain,s.public_contact,s.time_zone,s.time_zone_locked_at,u.email AS owner_email FROM shops s JOIN "user" u ON u.id=s.owner_id WHERE s.owner_id=${context.userId} FOR UPDATE OF s`,
      );
      const shop = locked.rows[0] as
        | {
            id: string;
            name: string;
            subdomain: string;
            public_contact: string;
            time_zone: string;
            time_zone_locked_at: Date | null;
            owner_email: string;
          }
        | undefined;
      if (!shop)
        return unavailable(
          "SHOP_REQUIRED",
          "Set up your shop before creating appointments.",
        );
      const now = new Date();
      const keyHash = hashSecret(parsed.data.recoveryKey);
      const digest = hashSecret(
        JSON.stringify({
          serviceId: parsed.data.serviceId,
          barberId: parsed.data.barberId,
          startAt: Temporal.Instant.from(parsed.data.startAt).toString(),
          reviewedOffer: parsed.data.reviewedOffer,
          contact: parsed.data.contact,
        }),
      );
      const existing = await tx.execute(
        sql`SELECT id,recovery_payload_digest,end_at,capability_hash,capability_ciphertext,capability_key_id,capability_revoked_at FROM bookings WHERE shop_id=${shop.id} AND creation_source='owner' AND recovery_key_hash=${keyHash} LIMIT 1`,
      );
      const recovered = existing.rows[0] as
        | {
            id: string;
            recovery_payload_digest: string;
            end_at: Date;
            capability_hash: string;
            capability_ciphertext: string;
            capability_key_id: string;
            capability_revoked_at: Date | null;
          }
        | undefined;
      if (recovered) {
        if (
          recovered.recovery_payload_digest !== digest ||
          recovered.capability_revoked_at ||
          now.getTime() >=
            new Date(recovered.end_at).getTime() + 168 * 60 * 60_000
        )
          return unavailable(
            "RECOVERY_MISMATCH",
            "This appointment attempt cannot be recovered.",
          );
        let token: string;
        try {
          token = decryptCapability(
            recovered.capability_ciphertext,
            recovered.capability_key_id,
            `${shop.id}:${recovered.id}`,
          );
        } catch {
          return unavailable(
            "RECOVERY_MISMATCH",
            "This appointment attempt cannot be recovered.",
          );
        }
        if (hashSecret(token) !== recovered.capability_hash)
          return unavailable(
            "RECOVERY_MISMATCH",
            "This appointment attempt cannot be recovered.",
          );
        return { success: true as const, bookingId: recovered.id };
      }
      const crossSourceKey = await tx.execute(
        sql`SELECT id FROM bookings WHERE shop_id=${shop.id} AND recovery_key_hash=${keyHash} LIMIT 1`,
      );
      if (crossSourceKey.rows.length)
        return unavailable(
          "RECOVERY_MISMATCH",
          "This appointment attempt cannot be recovered.",
        );
      const [service] = await tx
        .select()
        .from(services)
        .where(
          and(
            eq(services.shopId, shop.id),
            eq(services.id, parsed.data.serviceId),
          ),
        )
        .limit(1);
      const [barber] = await tx
        .select()
        .from(barbers)
        .where(
          and(
            eq(barbers.shopId, shop.id),
            eq(barbers.id, parsed.data.barberId),
          ),
        )
        .limit(1);
      const [assignment] = await tx
        .select({ barberId: barberServices.barberId })
        .from(barberServices)
        .where(
          and(
            eq(barberServices.shopId, shop.id),
            eq(barberServices.serviceId, parsed.data.serviceId),
            eq(barberServices.barberId, parsed.data.barberId),
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
        return unavailable(
          "STALE_OFFER",
          "That service or barber is no longer available. Review the current options.",
        );
      if (
        service.name !== parsed.data.reviewedOffer.name ||
        fixedBookingPrice(service.priceUsd) !==
          parsed.data.reviewedOffer.priceUsd ||
        String(service.durationMinutes) !==
          parsed.data.reviewedOffer.durationMinutes
      )
        return unavailable(
          "STALE_OFFER",
          "The service details changed. Review the current price and duration.",
        );
      const duration = Number(service.durationMinutes);
      const start = new Date(parsed.data.startAt);
      const startInstant = Temporal.Instant.from(parsed.data.startAt);
      const endInstant = startInstant.add({ minutes: duration });
      if (
        Temporal.Instant.compare(
          endInstant,
          Temporal.Instant.from(now.toISOString()),
        ) <= 0
      )
        return unavailable(
          "UNAVAILABLE_INTERVAL",
          "Choose a future or ongoing appointment interval.",
        );
      const end = new Date(endInstant.epochMilliseconds);
      const localDate = startInstant
        .toZonedDateTimeISO(shop.time_zone)
        .toPlainDate();
      const [shopWeek] = await tx
        .select({ week: shopSchedules.week })
        .from(shopSchedules)
        .where(eq(shopSchedules.shopId, shop.id))
        .limit(1);
      const [barberWeek] = await tx
        .select({ week: barberSchedules.week })
        .from(barberSchedules)
        .where(
          and(
            eq(barberSchedules.shopId, shop.id),
            eq(barberSchedules.barberId, barber.id),
          ),
        )
        .limit(1);
      if (!shopWeek || !barberWeek)
        return unavailable(
          "UNAVAILABLE_INTERVAL",
          "Choose another available time.",
        );
      const [shopException] = await tx
        .select()
        .from(shopDateSchedules)
        .where(
          and(
            eq(shopDateSchedules.shopId, shop.id),
            eq(shopDateSchedules.date, localDate.toString()),
          ),
        )
        .limit(1);
      const [barberException] = await tx
        .select()
        .from(barberDateSchedules)
        .where(
          and(
            eq(barberDateSchedules.shopId, shop.id),
            eq(barberDateSchedules.barberId, barber.id),
            eq(barberDateSchedules.date, localDate.toString()),
          ),
        )
        .limit(1);
      const weekday = localDate.dayOfWeek - 1;
      const shopDay = resolveDateSchedule(
        (shopWeek.week as WeeklySchedule)[weekday],
        shopException
          ? {
              override: shopException.override,
              closed: shopException.closed,
              revision: shopException.revision,
            }
          : null,
      );
      const barberDay = resolveDateSchedule(
        (barberWeek.week as WeeklySchedule)[weekday],
        barberException
          ? {
              override: barberException.override,
              closed: barberException.closed,
              revision: barberException.revision,
            }
          : null,
      );
      if (
        !fitsScheduleInterval({
          start: startInstant,
          durationMinutes: duration,
          date: localDate,
          timeZone: shop.time_zone,
          shopDay,
          barberDay,
        })
      )
        return unavailable(
          "UNAVAILABLE_INTERVAL",
          "Choose another available time.",
        );
      const overlaps = await tx
        .select({ id: occupiedIntervals.id })
        .from(occupiedIntervals)
        .where(
          and(
            eq(occupiedIntervals.shopId, shop.id),
            eq(occupiedIntervals.barberId, barber.id),
            sql`${occupiedIntervals.startAt}<${end}`,
            sql`${occupiedIntervals.endAt}>${start}`,
          ),
        )
        .limit(1);
      if (overlaps.length)
        return unavailable(
          "UNAVAILABLE_INTERVAL",
          "That time was just taken. Choose another available time.",
        );
      const id = randomUUID();
      const occupancyId = randomUUID();
      const token = createBearerSecret();
      const encrypted = encryptCapability(token, `${shop.id}:${id}`);
      const consentAt = parsed.data.contact.whatsappOptIn ? now : null;
      await tx.insert(occupiedIntervals).values({
        id: occupancyId,
        shopId: shop.id,
        barberId: barber.id,
        startAt: start,
        endAt: end,
      });
      await tx.insert(bookings).values({
        id,
        shopId: shop.id,
        serviceId: service.id,
        barberId: barber.id,
        occupancyId,
        status: "confirmed",
        startAt: start,
        endAt: end,
        serviceName: service.name,
        servicePriceUsd: service.priceUsd,
        serviceDurationMinutes: duration,
        barberName: barber.name,
        customerName: parsed.data.contact.name,
        customerEmail: parsed.data.contact.email ?? null,
        customerPhone: parsed.data.contact.phone ?? null,
        whatsappOptIn: parsed.data.contact.whatsappOptIn,
        whatsappConsentAt: consentAt,
        createdAt: now,
        capabilityHash: hashSecret(token),
        capabilityCiphertext: encrypted.ciphertext,
        capabilityKeyId: encrypted.keyId,
        recoveryKeyHash: keyHash,
        recoveryPayloadDigest: digest,
        creationSource: "owner",
      });
      const identity = notificationContentIdentity({
        id,
        startAt: start,
        endAt: end,
        serviceName: service.name,
        servicePriceUsd: service.priceUsd,
        serviceDurationMinutes: duration,
        barberName: barber.name,
        customerName: parsed.data.contact.name,
        customerEmail: parsed.data.contact.email ?? null,
        customerPhone: parsed.data.contact.phone ?? null,
      });
      const recipient = parsed.data.contact.email ?? null;
      await tx.insert(notificationWork).values([
        {
          id: randomUUID(),
          bookingId: id,
          kind: "customer_confirmation",
          channel: "email",
          status: !recipient
            ? "skipped"
            : emailConfig.mode === "mailpit"
              ? "not_attempted"
              : "unavailable",
          recipient,
          contentIdentity: identity,
          reason: !recipient
            ? "recipient_missing"
            : emailConfig.mode === "mailpit"
              ? null
              : emailConfig.reason,
        },
        ...(parsed.data.contact.whatsappOptIn && parsed.data.contact.phone
          ? [
              {
                id: randomUUID(),
                bookingId: id,
                kind: "customer_confirmation" as const,
                channel: "whatsapp" as const,
                status: "unavailable" as const,
                recipient: parsed.data.contact.phone,
                contentIdentity: identity,
                reason: "channel_unavailable",
              },
            ]
          : []),
      ]);
      if (!shop.time_zone_locked_at)
        await tx
          .update(shops)
          .set({ timeZoneLockedAt: now })
          .where(eq(shops.id, shop.id));
      return { success: true as const, bookingId: id };
    });
    if (!result.success) return result;
    bookingId = result.bookingId;
    const work = await db
      .select({
        status: notificationWork.status,
        reason: notificationWork.reason,
        claimedAt: notificationWork.claimedAt,
        updatedAt: notificationWork.updatedAt,
        channel: notificationWork.channel,
      })
      .from(notificationWork)
      .where(eq(notificationWork.bookingId, bookingId));
    const emailWork = work.find((row) => row.channel === "email");
    const appointment = await getOwnAppointment(context, bookingId);
    if (!appointment.success)
      return unavailable(
        "UNAVAILABLE",
        "Appointment was saved but could not be loaded. Retry with the same request.",
      );
    return {
      success: true,
      data: {
        bookingId,
        appointment: appointment.data,
        notifications: {
          email: customerEmailSummary(
            {
              status: emailWork?.status as
                ManagedBookingView["notifications"]["email"]["status"] | null,
              reason: emailWork?.reason ?? null,
              claimedAt: emailWork?.claimedAt ?? null,
              updatedAt: emailWork?.updatedAt ?? null,
            },
            new Date(),
          ),
          whatsapp: work.some((row) => row.channel === "whatsapp")
            ? "unavailable"
            : "not_requested",
        },
      },
    };
  } catch (error) {
    const cause =
      error instanceof Error && error.cause && typeof error.cause === "object"
        ? error.cause
        : error;
    if (
      cause &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "23P01"
    )
      return unavailable(
        "UNAVAILABLE_INTERVAL",
        "That time was just taken. Choose another available time.",
      );
    return unavailable(
      "UNAVAILABLE",
      "Appointment is temporarily unavailable. Please try again.",
    );
  }
}
