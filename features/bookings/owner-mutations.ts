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
import { bookingChanges } from "@/db/schema/booking-changes";
import { notificationWork } from "@/db/schema/notification-work";
import { resolveEmailConfig } from "@/features/notifications/config";
import { notificationContentIdentity } from "@/features/notifications/content-identity";
import { customerEmailSummary } from "@/features/notifications/customer-summary";
import { occupiedIntervals } from "@/db/schema/occupancy";
import { shops } from "@/db/schema/shops";
import type { ActionResult } from "@/lib/action-result";
import { fitsScheduleInterval } from "@/features/availability/slots";
import { resolveDateSchedule } from "@/features/availability/restrictions";
import type { WeeklySchedule } from "@/features/availability/types";
import {
  cancelOwnerBookingSchema,
  createOwnerBookingSchema,
  moveOwnerBookingSchema,
} from "./schemas";
import { fixedBookingPrice } from "./money";
import {
  createBearerSecret,
  decryptCapability,
  encryptCapability,
  hashSecret,
} from "./capabilities";
import type {
  ManagedBookingView,
  OwnerBookingReceipt,
  OwnerChangeReceipt,
} from "./types";
import type { OwnerContext } from "@/server/owner-context";
import { getOwnAppointment } from "./queries";

type RawBookingRow = {
  id: string;
  revision: number | string;
  status: string;
  service_id: string;
  service_name: string;
  service_price_usd: string;
  service_duration_minutes: number | string;
  barber_id: string;
  barber_name: string;
  start_at: Date | string;
  end_at: Date | string;
  occupancy_id: string | null;
  customer_name: string;
  customer_email: string | null;
  customer_phone: string | null;
  whatsapp_opt_in: boolean;
};

type RawBookingChange = {
  id: string;
  kind: string;
  applied_revision: number | string;
  committed_at: Date | string;
  after_snapshot: Record<string, unknown>;
  payload_digest: string;
};

export async function cancelOwnerBooking(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<OwnerChangeReceipt>> {
  const fail = (code: string, message: string) => ({
    success: false as const,
    error: { code, message },
  });
  if (!context?.userId)
    return fail("UNAUTHENTICATED", "Sign in to manage appointments.");
  const parsed = cancelOwnerBookingSchema.safeParse(input);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "Appointment request is invalid.");
  try {
    const receipt = await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id FROM shops WHERE owner_id=${context.userId} FOR UPDATE`,
      );
      const shopId = locked.rows[0]?.id as string | undefined;
      if (!shopId)
        return fail(
          "SHOP_REQUIRED",
          "Set up your shop to manage appointments.",
        );
      const now = new Date();
      const found = await tx.execute(
        sql`SELECT * FROM bookings WHERE id=${parsed.data.bookingId} AND shop_id=${shopId} FOR UPDATE`,
      );
      const booking = found.rows[0] as RawBookingRow | undefined;
      if (!booking) return fail("NOT_FOUND", "Appointment not found.");
      const keyHash = hashSecret(parsed.data.operationKey);
      const digest = hashSecret(
        JSON.stringify({
          kind: "cancel",
          bookingId: booking.id,
          expectedRevision: parsed.data.expectedRevision,
        }),
      );
      const replay = await tx.execute(
        sql`SELECT id, kind, applied_revision, committed_at, after_snapshot, payload_digest FROM booking_changes WHERE shop_id=${shopId} AND operation_key_hash=${keyHash}`,
      );
      if (replay.rows[0]) {
        const event = replay.rows[0] as RawBookingChange;
        if (event.payload_digest !== digest)
          return fail(
            "RECOVERY_MISMATCH",
            "This appointment attempt cannot be recovered.",
          );
        return {
          success: true as const,
          bookingId: booking.id as string,
          event,
        };
      }
      if (Number(booking.revision) !== parsed.data.expectedRevision)
        return fail(
          "STALE_BOOKING",
          "Appointment changed. Reload and try again.",
        );
      if (
        booking.status !== "confirmed" ||
        new Date(booking.end_at).getTime() <= now.getTime()
      )
        return fail(
          "INVALID_STATE",
          "This appointment can no longer be cancelled.",
        );
      const before = {
        status: booking.status,
        serviceId: booking.service_id,
        serviceName: booking.service_name,
        servicePriceUsd: booking.service_price_usd,
        serviceDurationMinutes: booking.service_duration_minutes,
        barberId: booking.barber_id,
        barberName: booking.barber_name,
        startAt: new Date(booking.start_at).toISOString(),
        endAt: new Date(booking.end_at).toISOString(),
      };
      const after = { ...before, status: "cancelled" };
      const eventId = randomUUID();
      const revision = Number(booking.revision) + 1;
      if (booking.occupancy_id)
        await tx.execute(
          sql`DELETE FROM occupied_intervals WHERE id=${booking.occupancy_id}`,
        );
      await tx.execute(
        sql`UPDATE bookings SET status='cancelled', occupancy_id=NULL, revision=${revision} WHERE id=${booking.id}`,
      );
      await tx.execute(
        sql`INSERT INTO booking_changes (id, shop_id, booking_id, actor_id, kind, applied_revision, committed_at, operation_key_hash, payload_digest, before_snapshot, after_snapshot) VALUES (${eventId},${shopId},${booking.id},${context.userId},'cancel',${revision},${now},${keyHash},${digest},${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)`,
      );
      const identity = notificationContentIdentity({
        id: booking.id,
        startAt: booking.start_at,
        endAt: booking.end_at,
        serviceName: booking.service_name,
        servicePriceUsd: booking.service_price_usd,
        serviceDurationMinutes: Number(booking.service_duration_minutes),
        barberName: booking.barber_name,
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        customerPhone: booking.customer_phone,
      });
      await tx
        .update(notificationWork)
        .set({ status: "suppressed", reason: "superseded", updatedAt: now })
        .where(
          and(
            eq(notificationWork.bookingId, booking.id),
            sql`${notificationWork.bookingRevision} < ${revision}`,
            eq(notificationWork.status, "not_attempted"),
          ),
        );
      const config = resolveEmailConfig(process.env);
      await tx.execute(
        sql`INSERT INTO notification_work (id, booking_id, booking_revision, change_id, kind, channel, status, recipient, content_identity, reason) VALUES (${randomUUID()},${booking.id},${revision},${eventId},'customer_cancellation','email',${booking.customer_email ? (config.mode === "mailpit" ? "not_attempted" : "unavailable") : "skipped"},${booking.customer_email},${identity},${booking.customer_email ? (config.mode === "unavailable" ? config.reason : null) : "recipient_missing"})`,
      );
      if (booking.whatsapp_opt_in && booking.customer_phone)
        await tx.execute(
          sql`INSERT INTO notification_work (id, booking_id, booking_revision, change_id, kind, channel, status, recipient, content_identity, reason) VALUES (${randomUUID()},${booking.id},${revision},${eventId},'customer_cancellation','whatsapp','unavailable',${booking.customer_phone},${identity},'channel_unavailable')`,
        );
      return {
        success: true as const,
        bookingId: booking.id as string,
        event: {
          id: eventId,
          kind: "cancel",
          applied_revision: revision,
          committed_at: now,
          after_snapshot: after,
        },
      };
    });
    if (!receipt.success) return receipt;
    const appointment = await getOwnAppointment(context, receipt.bookingId);
    if (!appointment.success)
      return fail("UNAVAILABLE", "Appointment could not be loaded.");
    const event = receipt.event as RawBookingChange;
    return {
      success: true,
      data: {
        bookingId: receipt.bookingId,
        operation: {
          id: event.id,
          kind: "cancel",
          revision: Number(event.applied_revision),
          committedAt: new Date(event.committed_at).toISOString(),
          snapshot: event.after_snapshot,
        },
        appointment: appointment.data,
      },
    };
  } catch {
    return fail(
      "UNAVAILABLE",
      "Appointment is temporarily unavailable. Try again.",
    );
  }
}

export async function moveOwnerBooking(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<OwnerChangeReceipt>> {
  const fail = (code: string, message: string) => ({
    success: false as const,
    error: { code, message },
  });
  if (!context?.userId)
    return fail("UNAUTHENTICATED", "Sign in to manage appointments.");
  const parsed = moveOwnerBookingSchema.safeParse(input);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "Appointment request is invalid.");
  try {
    const receipt = await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT id, time_zone FROM shops WHERE owner_id=${context.userId} FOR UPDATE`,
      );
      const shop = locked.rows[0] as
        { id: string; time_zone: string } | undefined;
      if (!shop)
        return fail(
          "SHOP_REQUIRED",
          "Set up your shop to manage appointments.",
        );
      const now = new Date();
      const found = await tx.execute(
        sql`SELECT * FROM bookings WHERE id=${parsed.data.bookingId} AND shop_id=${shop.id} FOR UPDATE`,
      );
      const booking = found.rows[0] as RawBookingRow | undefined;
      if (!booking) return fail("NOT_FOUND", "Appointment not found.");
      const keyHash = hashSecret(parsed.data.operationKey);
      const startInstant = Temporal.Instant.from(parsed.data.startAt);
      const digest = hashSecret(
        JSON.stringify({
          kind: "move",
          bookingId: booking.id,
          expectedRevision: parsed.data.expectedRevision,
          serviceId: parsed.data.serviceId,
          barberId: parsed.data.barberId,
          startAt: startInstant.toString(),
          reviewedOffer: parsed.data.reviewedOffer,
        }),
      );
      const replay = await tx.execute(
        sql`SELECT id, kind, applied_revision, committed_at, after_snapshot, payload_digest FROM booking_changes WHERE shop_id=${shop.id} AND operation_key_hash=${keyHash}`,
      );
      if (replay.rows[0]) {
        const event = replay.rows[0] as RawBookingChange;
        if (event.payload_digest !== digest)
          return fail(
            "RECOVERY_MISMATCH",
            "This appointment attempt cannot be recovered.",
          );
        return {
          success: true as const,
          bookingId: booking.id as string,
          event,
        };
      }
      if (Number(booking.revision) !== parsed.data.expectedRevision)
        return fail(
          "STALE_BOOKING",
          "Appointment changed. Reload and try again.",
        );
      if (
        booking.status !== "confirmed" ||
        new Date(booking.end_at).getTime() <= now.getTime()
      )
        return fail(
          "INVALID_STATE",
          "This appointment can no longer be moved.",
        );
      const currentSavedService = parsed.data.serviceId === booking.service_id;
      const [replacementService] = currentSavedService
        ? []
        : await tx
            .select()
            .from(services)
            .where(
              and(
                eq(services.shopId, shop.id),
                eq(services.id, parsed.data.serviceId),
              ),
            )
            .limit(1);
      if (
        (!currentSavedService &&
          (!replacementService ||
            !replacementService.offered ||
            replacementService.archived)) ||
        (currentSavedService &&
          (parsed.data.reviewedOffer.name !== booking.service_name ||
            parsed.data.reviewedOffer.priceUsd !==
              fixedBookingPrice(String(booking.service_price_usd)) ||
            parsed.data.reviewedOffer.durationMinutes !==
              String(booking.service_duration_minutes))) ||
        (!currentSavedService &&
          (parsed.data.reviewedOffer.name !== replacementService.name ||
            parsed.data.reviewedOffer.priceUsd !==
              fixedBookingPrice(String(replacementService.priceUsd)) ||
            parsed.data.reviewedOffer.durationMinutes !==
              String(replacementService.durationMinutes)))
      )
        return fail(
          "STALE_OFFER",
          "Review the current service before changing the appointment.",
        );
      const service = currentSavedService
        ? {
            id: booking.service_id as string,
            name: booking.service_name as string,
            priceUsd: String(booking.service_price_usd),
            durationMinutes: Number(booking.service_duration_minutes),
          }
        : {
            id: replacementService.id,
            name: replacementService.name,
            priceUsd: fixedBookingPrice(String(replacementService.priceUsd)),
            durationMinutes: Number(replacementService.durationMinutes),
          };
      const start = new Date(startInstant.epochMilliseconds);
      const endInstant = startInstant.add({
        minutes: service.durationMinutes,
      });
      const end = new Date(endInstant.epochMilliseconds);
      if (end.getTime() <= now.getTime())
        return fail(
          "UNAVAILABLE_INTERVAL",
          "Choose a future or ongoing appointment interval.",
        );
      if (
        service.id === booking.service_id &&
        parsed.data.barberId === booking.barber_id &&
        start.getTime() === new Date(booking.start_at).getTime()
      )
        return fail("NO_CHANGE", "Choose a different time or barber.");
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
            eq(barberServices.serviceId, service.id),
            eq(barberServices.barberId, parsed.data.barberId),
          ),
        )
        .limit(1);
      if (!barber || barber.archived || !assignment)
        return fail(
          "UNAVAILABLE_INTERVAL",
          "That barber is not available for this appointment.",
        );
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
        return fail("UNAVAILABLE_INTERVAL", "Choose another available time.");
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
      if (
        !fitsScheduleInterval({
          start: startInstant,
          durationMinutes: service.durationMinutes,
          date: localDate,
          timeZone: shop.time_zone,
          shopDay: resolveDateSchedule(
            (shopWeek.week as WeeklySchedule)[weekday],
            shopException
              ? {
                  override: shopException.override,
                  closed: shopException.closed,
                  revision: shopException.revision,
                }
              : null,
          ),
          barberDay: resolveDateSchedule(
            (barberWeek.week as WeeklySchedule)[weekday],
            barberException
              ? {
                  override: barberException.override,
                  closed: barberException.closed,
                  revision: barberException.revision,
                }
              : null,
          ),
        })
      )
        return fail("UNAVAILABLE_INTERVAL", "Choose another available time.");
      const occupancyId = booking.occupancy_id as string | null;
      if (!occupancyId)
        return fail("UNAVAILABLE", "Appointment reservation is unavailable.");
      const overlaps = await tx
        .select({ id: occupiedIntervals.id })
        .from(occupiedIntervals)
        .where(
          and(
            eq(occupiedIntervals.shopId, shop.id),
            eq(occupiedIntervals.barberId, barber.id),
            sql`${occupiedIntervals.id} <> ${occupancyId}`,
            sql`${occupiedIntervals.startAt}<${end}`,
            sql`${occupiedIntervals.endAt}>${start}`,
          ),
        )
        .limit(1);
      if (overlaps.length)
        return fail(
          "UNAVAILABLE_INTERVAL",
          "That time was just taken. Choose another available time.",
        );
      const before = {
        status: booking.status,
        serviceId: booking.service_id,
        serviceName: booking.service_name,
        servicePriceUsd: String(booking.service_price_usd),
        serviceDurationMinutes: Number(booking.service_duration_minutes),
        barberId: booking.barber_id,
        barberName: booking.barber_name,
        startAt: new Date(booking.start_at).toISOString(),
        endAt: new Date(booking.end_at).toISOString(),
      };
      const after = {
        ...before,
        serviceId: service.id,
        serviceName: service.name,
        servicePriceUsd: service.priceUsd,
        serviceDurationMinutes: service.durationMinutes,
        barberId: barber.id,
        barberName: barber.name,
        startAt: start.toISOString(),
        endAt: end.toISOString(),
      };
      const revision = Number(booking.revision) + 1;
      const eventId = randomUUID();
      await tx
        .update(occupiedIntervals)
        .set({ barberId: barber.id, startAt: start, endAt: end })
        .where(eq(occupiedIntervals.id, occupancyId));
      await tx
        .update(bookings)
        .set({
          serviceId: service.id,
          serviceName: service.name,
          servicePriceUsd: service.priceUsd,
          serviceDurationMinutes: service.durationMinutes,
          barberId: barber.id,
          barberName: barber.name,
          startAt: start,
          endAt: end,
          revision,
        })
        .where(eq(bookings.id, booking.id));
      await tx.insert(bookingChanges).values({
        id: eventId,
        shopId: shop.id,
        bookingId: booking.id,
        actorId: context.userId,
        kind: "move",
        appliedRevision: revision,
        committedAt: now,
        operationKeyHash: keyHash,
        payloadDigest: digest,
        beforeSnapshot: before,
        afterSnapshot: after,
      });
      const identity = notificationContentIdentity({
        id: booking.id,
        startAt: start,
        endAt: end,
        serviceName: service.name,
        servicePriceUsd: service.priceUsd,
        serviceDurationMinutes: service.durationMinutes,
        barberName: barber.name,
        customerName: booking.customer_name,
        customerEmail: booking.customer_email,
        customerPhone: booking.customer_phone,
      });
      const emailConfig = resolveEmailConfig(process.env);
      await tx
        .update(notificationWork)
        .set({ status: "suppressed", reason: "superseded", updatedAt: now })
        .where(
          and(
            eq(notificationWork.bookingId, booking.id),
            sql`${notificationWork.bookingRevision} < ${revision}`,
            eq(notificationWork.status, "not_attempted"),
          ),
        );
      await tx.insert(notificationWork).values([
        {
          id: randomUUID(),
          bookingId: booking.id,
          bookingRevision: revision,
          changeId: eventId,
          kind: "customer_move",
          channel: "email",
          status: !booking.customer_email
            ? "skipped"
            : emailConfig.mode === "mailpit"
              ? "not_attempted"
              : "unavailable",
          recipient: booking.customer_email,
          contentIdentity: identity,
          reason: !booking.customer_email
            ? "recipient_missing"
            : emailConfig.mode === "unavailable"
              ? emailConfig.reason
              : null,
        },
        ...(booking.whatsapp_opt_in && booking.customer_phone
          ? [
              {
                id: randomUUID(),
                bookingId: booking.id,
                bookingRevision: revision,
                changeId: eventId,
                kind: "customer_move" as const,
                channel: "whatsapp" as const,
                status: "unavailable" as const,
                recipient: booking.customer_phone,
                contentIdentity: identity,
                reason: "channel_unavailable",
              },
            ]
          : []),
      ]);
      return {
        success: true as const,
        bookingId: booking.id as string,
        event: {
          id: eventId,
          kind: "move",
          applied_revision: revision,
          committed_at: now,
          after_snapshot: after,
        },
      };
    });
    if (!receipt.success) return receipt;
    const appointment = await getOwnAppointment(context, receipt.bookingId);
    if (!appointment.success)
      return fail("UNAVAILABLE", "Appointment could not be loaded.");
    const event = receipt.event as RawBookingChange;
    return {
      success: true,
      data: {
        bookingId: receipt.bookingId,
        operation: {
          id: event.id,
          kind: "move",
          revision: Number(event.applied_revision),
          committedAt: new Date(event.committed_at).toISOString(),
          snapshot: event.after_snapshot,
        },
        appointment: appointment.data,
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
      return fail(
        "UNAVAILABLE_INTERVAL",
        "That time was just taken. Choose another available time.",
      );
    return fail("UNAVAILABLE", "Appointment is temporarily unavailable.");
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
