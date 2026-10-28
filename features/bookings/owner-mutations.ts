import "server-only";
import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
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
import { resolveScheduleForDate } from "@/features/availability/schedule-resolution";
import {
  cancelOwnerBookingSchema,
  createOwnerBookingSchema,
  moveOwnerBookingSchema,
} from "./schemas";
import { fixedBookingPrice } from "./money";
import { hashSecret } from "./capabilities";
import {
  findCreationReplay,
  findOccupyingInterval,
  persistBookingCreation,
  resolveCreationOffer,
} from "./creation-primitives";
import {
  stageCustomerChangeNotifications,
  suppressSupersededNotificationWork,
} from "./notification-staging";
import type {
  ManagedBookingView,
  OwnerBookingReceipt,
  OwnerChangeReceipt,
} from "./types";
import type { OwnerContext } from "@/server/owner-context";
import { getOwnAppointment } from "./queries";

type BookingChangeEvent = {
  id: string;
  kind: "move" | "cancel";
  appliedRevision: number;
  committedAt: Date;
  afterSnapshot: Record<string, unknown>;
};

function bookingChangeEvent(row: {
  id: string;
  kind: string;
  appliedRevision: number;
  committedAt: Date;
  afterSnapshot: unknown;
}): BookingChangeEvent {
  return {
    id: row.id,
    kind: row.kind as BookingChangeEvent["kind"],
    appliedRevision: row.appliedRevision,
    committedAt: row.committedAt,
    afterSnapshot: row.afterSnapshot as Record<string, unknown>,
  };
}

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
      const [lockedShop] = await tx
        .select({ id: shops.id })
        .from(shops)
        .where(eq(shops.ownerId, context.userId))
        .for("update")
        .limit(1);
      const shopId = lockedShop?.id;
      if (!shopId)
        return fail(
          "SHOP_REQUIRED",
          "Set up your shop to manage appointments.",
        );
      const now = new Date();
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.id, parsed.data.bookingId),
            eq(bookings.shopId, shopId),
          ),
        )
        .for("update")
        .limit(1);
      if (!booking) return fail("NOT_FOUND", "Appointment not found.");
      const keyHash = hashSecret(parsed.data.operationKey);
      const digest = hashSecret(
        JSON.stringify({
          kind: "cancel",
          bookingId: booking.id,
          expectedRevision: parsed.data.expectedRevision,
        }),
      );
      const [replay] = await tx
        .select({
          id: bookingChanges.id,
          kind: bookingChanges.kind,
          appliedRevision: bookingChanges.appliedRevision,
          committedAt: bookingChanges.committedAt,
          afterSnapshot: bookingChanges.afterSnapshot,
          payloadDigest: bookingChanges.payloadDigest,
        })
        .from(bookingChanges)
        .where(
          and(
            eq(bookingChanges.shopId, shopId),
            eq(bookingChanges.operationKeyHash, keyHash),
          ),
        )
        .limit(1);
      if (replay) {
        if (replay.payloadDigest !== digest)
          return fail(
            "RECOVERY_MISMATCH",
            "This appointment attempt cannot be recovered.",
          );
        return {
          success: true as const,
          bookingId: booking.id,
          event: bookingChangeEvent(replay),
        };
      }
      if (booking.revision !== parsed.data.expectedRevision)
        return fail(
          "STALE_BOOKING",
          "Appointment changed. Reload and try again.",
        );
      if (
        booking.status !== "confirmed" ||
        booking.endAt.getTime() <= now.getTime()
      )
        return fail(
          "INVALID_STATE",
          "This appointment can no longer be cancelled.",
        );
      const before = {
        status: booking.status,
        serviceId: booking.serviceId,
        serviceName: booking.serviceName,
        servicePriceUsd: booking.servicePriceUsd,
        serviceDurationMinutes: booking.serviceDurationMinutes,
        barberId: booking.barberId,
        barberName: booking.barberName,
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
      };
      const after = { ...before, status: "cancelled" };
      const eventId = randomUUID();
      const revision = booking.revision + 1;
      if (booking.occupancyId)
        await tx.execute(
          sql`DELETE FROM occupied_intervals WHERE id=${booking.occupancyId}`,
        );
      await tx.execute(
        sql`UPDATE bookings SET status='cancelled', occupancy_id=NULL, revision=${revision} WHERE id=${booking.id}`,
      );
      await tx.execute(
        sql`INSERT INTO booking_changes (id, shop_id, booking_id, actor_id, kind, applied_revision, committed_at, operation_key_hash, payload_digest, before_snapshot, after_snapshot) VALUES (${eventId},${shopId},${booking.id},${context.userId},'cancel',${revision},${now},${keyHash},${digest},${JSON.stringify(before)}::jsonb,${JSON.stringify(after)}::jsonb)`,
      );
      const identity = notificationContentIdentity({
        id: booking.id,
        startAt: booking.startAt,
        endAt: booking.endAt,
        serviceName: booking.serviceName,
        servicePriceUsd: booking.servicePriceUsd,
        serviceDurationMinutes: booking.serviceDurationMinutes,
        barberName: booking.barberName,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
      });
      await suppressSupersededNotificationWork(tx, booking.id, revision, now);
      const config = resolveEmailConfig(process.env);
      await stageCustomerChangeNotifications(tx, {
        bookingId: booking.id,
        revision,
        changeId: eventId,
        kind: "customer_cancellation",
        contentIdentity: identity,
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
        whatsappOptIn: booking.whatsappOptIn,
        emailConfig: config,
      });
      return {
        success: true as const,
        bookingId: booking.id,
        event: {
          id: eventId,
          kind: "cancel" as const,
          appliedRevision: revision,
          committedAt: now,
          afterSnapshot: after,
        },
      };
    });
    if (!receipt.success) return receipt;
    const appointment = await getOwnAppointment(context, receipt.bookingId);
    if (!appointment.success)
      return fail("UNAVAILABLE", "Appointment could not be loaded.");
    const event = receipt.event;
    return {
      success: true,
      data: {
        bookingId: receipt.bookingId,
        operation: {
          id: event.id,
          kind: "cancel",
          revision: event.appliedRevision,
          committedAt: event.committedAt.toISOString(),
          snapshot: event.afterSnapshot,
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
      const [shop] = await tx
        .select({ id: shops.id, timeZone: shops.timeZone })
        .from(shops)
        .where(eq(shops.ownerId, context.userId))
        .for("update")
        .limit(1);
      if (!shop)
        return fail(
          "SHOP_REQUIRED",
          "Set up your shop to manage appointments.",
        );
      const now = new Date();
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.id, parsed.data.bookingId),
            eq(bookings.shopId, shop.id),
          ),
        )
        .for("update")
        .limit(1);
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
      const [replay] = await tx
        .select({
          id: bookingChanges.id,
          kind: bookingChanges.kind,
          appliedRevision: bookingChanges.appliedRevision,
          committedAt: bookingChanges.committedAt,
          afterSnapshot: bookingChanges.afterSnapshot,
          payloadDigest: bookingChanges.payloadDigest,
        })
        .from(bookingChanges)
        .where(
          and(
            eq(bookingChanges.shopId, shop.id),
            eq(bookingChanges.operationKeyHash, keyHash),
          ),
        )
        .limit(1);
      if (replay) {
        if (replay.payloadDigest !== digest)
          return fail(
            "RECOVERY_MISMATCH",
            "This appointment attempt cannot be recovered.",
          );
        return {
          success: true as const,
          bookingId: booking.id,
          event: bookingChangeEvent(replay),
        };
      }
      if (booking.revision !== parsed.data.expectedRevision)
        return fail(
          "STALE_BOOKING",
          "Appointment changed. Reload and try again.",
        );
      if (
        booking.status !== "confirmed" ||
        booking.endAt.getTime() <= now.getTime()
      )
        return fail(
          "INVALID_STATE",
          "This appointment can no longer be moved.",
        );
      const currentSavedService = parsed.data.serviceId === booking.serviceId;
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
          (parsed.data.reviewedOffer.name !== booking.serviceName ||
            parsed.data.reviewedOffer.priceUsd !==
              fixedBookingPrice(booking.servicePriceUsd) ||
            parsed.data.reviewedOffer.durationMinutes !==
              String(booking.serviceDurationMinutes))) ||
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
            id: booking.serviceId,
            name: booking.serviceName,
            priceUsd: booking.servicePriceUsd,
            durationMinutes: booking.serviceDurationMinutes,
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
        service.id === booking.serviceId &&
        parsed.data.barberId === booking.barberId &&
        start.getTime() === booking.startAt.getTime()
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
        .toZonedDateTimeISO(shop.timeZone)
        .toPlainDate();
      const schedule = await resolveScheduleForDate(tx, {
        shopId: shop.id,
        barberId: barber.id,
        date: localDate,
      });
      if (!schedule.hasWeeklySchedule)
        return fail("UNAVAILABLE_INTERVAL", "Choose another available time.");
      if (
        !fitsScheduleInterval({
          start: startInstant,
          durationMinutes: service.durationMinutes,
          date: localDate,
          timeZone: shop.timeZone,
          shopDay: schedule.shopDay,
          barberDay: schedule.barberDay,
        })
      )
        return fail("UNAVAILABLE_INTERVAL", "Choose another available time.");
      const occupancyId = booking.occupancyId;
      if (!occupancyId)
        return fail("UNAVAILABLE", "Appointment reservation is unavailable.");
      const overlap = await findOccupyingInterval(tx, {
        shopId: shop.id,
        barberId: barber.id,
        start,
        end,
        excludeOccupancyId: occupancyId,
      });
      if (overlap)
        return fail(
          "UNAVAILABLE_INTERVAL",
          "That time was just taken. Choose another available time.",
        );
      const before = {
        status: booking.status,
        serviceId: booking.serviceId,
        serviceName: booking.serviceName,
        servicePriceUsd: booking.servicePriceUsd,
        serviceDurationMinutes: booking.serviceDurationMinutes,
        barberId: booking.barberId,
        barberName: booking.barberName,
        startAt: booking.startAt.toISOString(),
        endAt: booking.endAt.toISOString(),
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
      const revision = booking.revision + 1;
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
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
      });
      const emailConfig = resolveEmailConfig(process.env);
      await suppressSupersededNotificationWork(tx, booking.id, revision, now);
      await stageCustomerChangeNotifications(tx, {
        bookingId: booking.id,
        revision,
        changeId: eventId,
        kind: "customer_move",
        contentIdentity: identity,
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
        whatsappOptIn: booking.whatsappOptIn,
        emailConfig,
      });
      return {
        success: true as const,
        bookingId: booking.id,
        event: {
          id: eventId,
          kind: "move" as const,
          appliedRevision: revision,
          committedAt: now,
          afterSnapshot: after,
        },
      };
    });
    if (!receipt.success) return receipt;
    const appointment = await getOwnAppointment(context, receipt.bookingId);
    if (!appointment.success)
      return fail("UNAVAILABLE", "Appointment could not be loaded.");
    const event = receipt.event;
    return {
      success: true,
      data: {
        bookingId: receipt.bookingId,
        operation: {
          id: event.id,
          kind: "move",
          revision: event.appliedRevision,
          committedAt: event.committedAt.toISOString(),
          snapshot: event.afterSnapshot,
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
      // Retain SQL for the joined read: only the shops row is locked while the
      // owner email is joined, matching the public creation lock scope.
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
      const digest = hashSecret(
        JSON.stringify({
          serviceId: parsed.data.serviceId,
          barberId: parsed.data.barberId,
          startAt: Temporal.Instant.from(parsed.data.startAt).toString(),
          reviewedOffer: parsed.data.reviewedOffer,
          contact: parsed.data.contact,
        }),
      );
      const recovered = await findCreationReplay(tx, {
        shopId: shop.id,
        creationSource: "owner",
        recoveryKey: parsed.data.recoveryKey,
        payloadDigest: digest,
        now,
      });
      if (recovered.status === "matched")
        return { success: true as const, bookingId: recovered.bookingId };
      if (recovered.status === "mismatch")
        return unavailable(
          "RECOVERY_MISMATCH",
          "This appointment attempt cannot be recovered.",
        );
      const offer = await resolveCreationOffer(tx, {
        shopId: shop.id,
        serviceId: parsed.data.serviceId,
        barberId: parsed.data.barberId,
        reviewedOffer: parsed.data.reviewedOffer,
      });
      if (!offer.ok)
        return offer.reason === "unavailable"
          ? unavailable(
              "STALE_OFFER",
              "That service or barber is no longer available. Review the current options.",
            )
          : unavailable(
              "STALE_OFFER",
              "The service details changed. Review the current price and duration.",
            );
      const { service, barber } = offer;
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
      const schedule = await resolveScheduleForDate(tx, {
        shopId: shop.id,
        barberId: barber.id,
        date: localDate,
      });
      if (!schedule.hasWeeklySchedule)
        return unavailable(
          "UNAVAILABLE_INTERVAL",
          "Choose another available time.",
        );
      if (
        !fitsScheduleInterval({
          start: startInstant,
          durationMinutes: duration,
          date: localDate,
          timeZone: shop.time_zone,
          shopDay: schedule.shopDay,
          barberDay: schedule.barberDay,
        })
      )
        return unavailable(
          "UNAVAILABLE_INTERVAL",
          "Choose another available time.",
        );
      const overlap = await findOccupyingInterval(tx, {
        shopId: shop.id,
        barberId: barber.id,
        start,
        end,
      });
      if (overlap)
        return unavailable(
          "UNAVAILABLE_INTERVAL",
          "That time was just taken. Choose another available time.",
        );
      const recipient = parsed.data.contact.email ?? null;
      const { bookingId: id } = await persistBookingCreation(tx, {
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
          email: recipient,
          phone: parsed.data.contact.phone ?? null,
          whatsappOptIn: parsed.data.contact.whatsappOptIn,
        },
        creationSource: "owner",
        recoveryKey: parsed.data.recoveryKey,
        payloadDigest: digest,
        now,
        notifications: [
          {
            kind: "customer_confirmation",
            channel: "email",
            status: !recipient
              ? "skipped"
              : emailConfig.mode === "mailpit"
                ? "not_attempted"
                : "unavailable",
            recipient,
            reason: !recipient
              ? "recipient_missing"
              : emailConfig.mode === "mailpit"
                ? null
                : emailConfig.reason,
          },
          ...(parsed.data.contact.whatsappOptIn && parsed.data.contact.phone
            ? [
                {
                  kind: "customer_confirmation" as const,
                  channel: "whatsapp" as const,
                  status: "unavailable" as const,
                  recipient: parsed.data.contact.phone,
                  reason: "channel_unavailable",
                },
              ]
            : []),
        ],
      });
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
