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
import { restoreOwnerBookingSchema } from "../schemas";
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

const RESTORE_OCCUPIED_TIME_MESSAGE =
  "This time is already booked or blocked. Free this time before restoring the appointment.";

export async function restoreOwnerBooking(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<OwnerChangeReceipt>> {
  const fail = (code: string, message: string) => ({
    success: false as const,
    error: { code, message },
  });
  if (!context?.userId)
    return fail("UNAUTHENTICATED", "Sign in to manage appointments.");
  const parsed = restoreOwnerBookingSchema.safeParse(input);
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
      const digest = hashSecret(
        JSON.stringify({
          kind: "restore",
          bookingId: booking.id,
          expectedRevision: parsed.data.expectedRevision,
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
        booking.status !== "cancelled" ||
        booking.startAt.getTime() <= now.getTime()
      )
        return fail(
          "INVALID_STATE",
          "This appointment can no longer be restored.",
        );

      const [service] = await tx
        .select()
        .from(services)
        .where(
          and(eq(services.shopId, shop.id), eq(services.id, booking.serviceId)),
        )
        .limit(1);
      if (!service || service.archived)
        return fail(
          "UNAVAILABLE_INTERVAL",
          "That service is not available for this appointment.",
        );
      const [barber] = await tx
        .select()
        .from(barbers)
        .where(
          and(eq(barbers.shopId, shop.id), eq(barbers.id, booking.barberId)),
        )
        .limit(1);
      const [assignment] = await tx
        .select({ barberId: barberServices.barberId })
        .from(barberServices)
        .where(
          and(
            eq(barberServices.shopId, shop.id),
            eq(barberServices.serviceId, booking.serviceId),
            eq(barberServices.barberId, booking.barberId),
          ),
        )
        .limit(1);
      if (!barber || barber.archived || !assignment)
        return fail(
          "UNAVAILABLE_INTERVAL",
          "That barber is not available for this appointment.",
        );

      const startInstant = Temporal.Instant.from(booking.startAt.toISOString());
      const localDate = startInstant
        .toZonedDateTimeISO(shop.timeZone)
        .toPlainDate();
      const schedule = await resolveScheduleForDate(tx, {
        shopId: shop.id,
        barberId: barber.id,
        date: localDate,
      });
      if (!schedule.hasWeeklySchedule)
        return fail(
          "UNAVAILABLE_INTERVAL",
          "This appointment time is no longer available.",
        );
      const expectedEndMs =
        booking.startAt.getTime() + booking.serviceDurationMinutes * 60 * 1000;
      if (booking.endAt.getTime() !== expectedEndMs)
        return fail(
          "UNAVAILABLE_INTERVAL",
          "This appointment time is no longer available.",
        );
      if (
        !fitsScheduleInterval({
          start: startInstant,
          durationMinutes: booking.serviceDurationMinutes,
          date: localDate,
          timeZone: shop.timeZone,
          shopDay: schedule.shopDay,
          barberDay: schedule.barberDay,
        })
      )
        return fail(
          "UNAVAILABLE_INTERVAL",
          "This appointment time is no longer available.",
        );

      const overlap = await findOccupyingInterval(tx, {
        shopId: shop.id,
        barberId: barber.id,
        start: booking.startAt,
        end: booking.endAt,
      });
      if (overlap)
        return fail("UNAVAILABLE_INTERVAL", RESTORE_OCCUPIED_TIME_MESSAGE);

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
      const after = { ...before, status: "confirmed" };
      const eventId = randomUUID();
      const revision = booking.revision + 1;
      const occupancyId = randomUUID();

      await tx.insert(occupiedIntervals).values({
        id: occupancyId,
        shopId: shop.id,
        barberId: barber.id,
        startAt: booking.startAt,
        endAt: booking.endAt,
      });
      await tx
        .update(bookings)
        .set({
          status: "confirmed",
          occupancyId,
          revision,
        })
        .where(eq(bookings.id, booking.id));
      await tx.insert(bookingChanges).values({
        id: eventId,
        shopId: shop.id,
        bookingId: booking.id,
        actorId: context.userId,
        kind: "restore",
        appliedRevision: revision,
        committedAt: now,
        operationKeyHash: keyHash,
        payloadDigest: digest,
        beforeSnapshot: before,
        afterSnapshot: after,
      });
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
      const emailConfig = resolveEmailConfig(process.env);
      await stageCustomerChangeNotifications(tx, {
        bookingId: booking.id,
        revision,
        changeId: eventId,
        kind: "customer_restoration",
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
          kind: "restore" as const,
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
          kind: "restore",
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
      return fail("UNAVAILABLE_INTERVAL", RESTORE_OCCUPIED_TIME_MESSAGE);
    return fail(
      "UNAVAILABLE",
      "Appointment is temporarily unavailable. Try again.",
    );
  }
}
