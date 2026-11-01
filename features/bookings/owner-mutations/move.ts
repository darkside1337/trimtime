import "server-only";
import { randomUUID } from "node:crypto";
import { Temporal } from "temporal-polyfill";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { barberServices, barbers, services } from "@/db/schema/catalog";
import { bookings } from "@/db/schema/bookings";
import { bookingChanges } from "@/db/schema/booking-changes";
import { resolveEmailConfig } from "@/features/notifications/config";
import { notificationContentIdentity } from "@/features/notifications/content-identity";
import { occupiedIntervals } from "@/db/schema/occupancy";
import { shops } from "@/db/schema/shops";
import type { ActionResult } from "@/lib/action-result";
import { fitsScheduleInterval } from "@/features/availability/slots";
import { resolveScheduleForDate } from "@/features/availability/schedule-resolution";
import { moveOwnerBookingSchema } from "../schemas";
import { fixedBookingPrice } from "../money";
import { hashSecret } from "../capabilities";
import { findOccupyingInterval } from "../creation-primitives";
import {
  stageCustomerChangeNotifications,
  suppressSupersededNotificationWork,
} from "../notification-staging";
import type { OwnerChangeReceipt } from "../types";
import type { OwnerContext } from "@/server/owner-context";
import { getOwnAppointment } from "../queries";
import { bookingChangeEvent } from "./booking-change-event";
import { findOwnerChangeReplay } from "./replay";

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
      const replay = await findOwnerChangeReplay(tx, {
        shopId: shop.id,
        operationKeyHash: keyHash,
      });
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
