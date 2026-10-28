import "server-only";
import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { resolveEmailConfig } from "@/features/notifications/config";
import { customerEmailSummary } from "@/features/notifications/customer-summary";
import { publicRateEvents, publicRateKeys } from "@/db/schema/public-limits";
import { occupiedIntervals } from "@/db/schema/occupancy";
import type { ActionResult } from "@/lib/action-result";
import { calculateSlots } from "@/features/availability/slots";
import { resolveScheduleForDate } from "@/features/availability/schedule-resolution";
import { createPublicBookingSchema } from "./schemas";
import { canonicalManageUrl, hashSecret } from "./capabilities";
import {
  findCreationReplay,
  persistBookingCreation,
  resolveCreationOffer,
} from "./creation-primitives";
import type {
  BookingFailureCode,
  ManagedBookingView,
  PublicBookingContext,
  PublicBookingInput,
  PublicBookingReceipt,
} from "./types";

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

      const recovered = await findCreationReplay(tx, {
        shopId: shop.id,
        creationSource: "public",
        recoveryKey: parsed.data.recoveryKey,
        payloadDigest: digest,
        now,
      });
      if (recovered.status === "matched") {
        try {
          const receipt = await receiptFor(tx, recovered.bookingId, "", now);
          if (receipt) {
            receipt.manageUrl = canonicalManageUrl(
              shop.subdomain,
              recovered.token,
            );
            return { success: true, data: receipt };
          }
        } catch {
          // An unrecoverable receipt must not disclose a capability.
        }
        return failure(
          "RECOVERY_MISMATCH",
          "This booking attempt cannot be recovered.",
        );
      }
      if (recovered.status === "mismatch")
        return failure(
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
      const offer = await resolveCreationOffer(tx, {
        shopId: shop.id,
        serviceId: parsed.data.serviceId,
        barberId: parsed.data.barberId,
        reviewedOffer: parsed.data.reviewedOffer,
      });
      if (!offer.ok)
        return offer.reason === "unavailable"
          ? failure(
              "STALE_OFFER",
              "That service or barber is no longer available. Review the current options.",
            )
          : failure(
              "STALE_OFFER",
              "The service details changed. Review the current price and duration.",
            );
      const { service, barber } = offer;
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
      const schedule = await resolveScheduleForDate(tx, {
        shopId: shop.id,
        barberId: barber.id,
        date: localDate,
      });
      if (!schedule.hasWeeklySchedule)
        return failure(
          "UNAVAILABLE_INTERVAL",
          "Choose another available time.",
        );
      const { shopDay, barberDay } = schedule;
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

      const emailStatus =
        emailConfig.mode === "mailpit" ? "not_attempted" : "unavailable";
      const emailReason =
        emailConfig.mode === "mailpit" ? null : emailConfig.reason;
      const { bookingId, token } = await persistBookingCreation(tx, {
        shop: {
          id: shop.id,
          timeZoneLockedAt: shop.time_zone_locked_at,
        },
        service,
        barber,
        start,
        end,
        durationMinutes: duration,
        contact: {
          name: parsed.data.contact.name,
          email: parsed.data.contact.email,
          phone: parsed.data.contact.phone ?? null,
          whatsappOptIn: parsed.data.contact.whatsappOptIn,
        },
        creationSource: "public",
        recoveryKey: parsed.data.recoveryKey,
        payloadDigest: digest,
        now,
        notifications: [
          {
            kind: "customer_confirmation",
            channel: "email",
            status: emailStatus,
            recipient: parsed.data.contact.email,
            reason: emailReason,
          },
          {
            kind: "owner_alert",
            channel: "email",
            status: emailStatus,
            recipient: shop.owner_email,
            reason: emailReason,
          },
          ...(parsed.data.contact.whatsappOptIn
            ? [
                {
                  kind: "customer_confirmation" as const,
                  channel: "whatsapp" as const,
                  status: "unavailable" as const,
                  recipient: parsed.data.contact.phone ?? null,
                  reason: "channel_unavailable",
                },
              ]
            : []),
        ],
      });
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
