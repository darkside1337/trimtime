import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { bookings } from "@/db/schema/bookings";
import { bookingChanges } from "@/db/schema/booking-changes";
import { barberServices, barbers } from "@/db/schema/catalog";
import { occupiedIntervals } from "@/db/schema/occupancy";
import { resolveScheduleForDate } from "@/features/availability/schedule-resolution";
import { calculateSlots } from "@/features/availability/slots";
import { resolveEmailConfig } from "@/features/notifications/config";
import { notificationContentIdentity } from "@/features/notifications/content-identity";
import type { ActionResult } from "@/lib/action-result";
import { hashSecret } from "../capabilities";
import { findOccupyingInterval } from "../creation-primitives";
import {
  stageCustomerReminder,
  stageCustomerChangeNotifications,
  suppressSupersededNotificationWork,
} from "../notification-staging";
import { recordRateEvent } from "../public-mutations";
import { replaceCustomerBookingSchema } from "../schemas";
import type {
  CustomerReplacementReceipt,
  PublicBookingContext,
} from "../types";
import { findShopChangeReplay, resolveChangeOffer } from "../change-primitives";
import {
  isCustomerChangeCutoffPassed,
  isCustomerManageLinkValid,
} from "../customer-primitives";

function failure(code: string, message: string) {
  return { success: false as const, error: { code, message } };
}

export async function replaceCustomerBooking(
  context: PublicBookingContext | null,
  input: unknown,
): Promise<ActionResult<CustomerReplacementReceipt>> {
  if (!context?.shopId)
    return failure("UNAVAILABLE", "This booking link is unavailable.");
  const parsed = replaceCustomerBookingSchema.safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Appointment request is invalid.");
  try {
    return await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT s.id, s.time_zone, u.email AS owner_email FROM shops s JOIN "user" u ON u.id=s.owner_id WHERE s.id=${context.shopId} FOR UPDATE OF s`,
      );
      const shop = locked.rows[0] as
        { id: string; time_zone: string; owner_email: string } | undefined;
      if (!shop)
        return failure("UNAVAILABLE", "This booking link is unavailable.");

      const now = new Date();
      const capabilityHash = hashSecret(parsed.data.token);
      const [booking] = await tx
        .select()
        .from(bookings)
        .where(
          and(
            eq(bookings.shopId, shop.id),
            eq(bookings.capabilityHash, capabilityHash),
          ),
        )
        .for("update")
        .limit(1);

      if (
        !booking ||
        !isCustomerManageLinkValid(
          booking.endAt,
          booking.capabilityRevokedAt,
          now,
        )
      )
        return failure("UNAVAILABLE", "This booking link is unavailable.");

      const startInstant = Temporal.Instant.from(parsed.data.startAt);
      const operationKeyHash = hashSecret(parsed.data.operationKey);
      const digest = hashSecret(
        JSON.stringify({
          kind: "move",
          actorType: "customer",
          shopId: shop.id,
          bookingId: booking.id,
          capabilityHash,
          expectedRevision: parsed.data.expectedRevision,
          confirmed: parsed.data.confirmed,
          serviceId: parsed.data.serviceId,
          barberId: parsed.data.barberId,
          startAt: startInstant.toString(),
          reviewedOffer: parsed.data.reviewedOffer,
        }),
      );

      const replay = await findShopChangeReplay(tx, {
        shopId: shop.id,
        operationKeyHash,
      });

      if (
        replay &&
        replay.bookingId === booking.id &&
        replay.actorType === "customer" &&
        replay.kind === "move" &&
        replay.payloadDigest === digest
      ) {
        return {
          success: true as const,
          data: {
            bookingId: replay.bookingId,
            operation: {
              id: replay.id,
              revision: replay.appliedRevision,
              committedAt: replay.committedAt.toISOString(),
              snapshot: replay.afterSnapshot as Record<string, unknown>,
            },
          },
        };
      }

      const rateAllowed = await recordRateEvent(
        tx,
        "customer_change_link",
        `${shop.id}:${parsed.data.token}`,
        now,
        10,
      );
      if (!rateAllowed)
        return failure(
          "RATE_LIMITED",
          "Too many change attempts. Please wait before trying again.",
        );

      if (replay)
        return failure(
          "RECOVERY_MISMATCH",
          "This appointment attempt cannot be recovered.",
        );

      if (booking.revision !== parsed.data.expectedRevision)
        return failure(
          "STALE_BOOKING",
          "Appointment changed. Reload and try again.",
        );

      if (booking.status !== "confirmed")
        return failure(
          "INVALID_STATE",
          "This appointment can no longer be moved.",
        );

      if (isCustomerChangeCutoffPassed(booking.startAt, now))
        return failure(
          "CUTOFF_PASSED",
          "This appointment is inside the change window. Contact the shop.",
        );

      const offer = await resolveChangeOffer(tx, {
        shopId: shop.id,
        requestedServiceId: parsed.data.serviceId,
        savedService: {
          id: booking.serviceId,
          name: booking.serviceName,
          priceUsd: booking.servicePriceUsd,
          durationMinutes: booking.serviceDurationMinutes,
        },
        reviewedOffer: parsed.data.reviewedOffer,
        retainedServiceMustBeNonarchived: true,
      });
      if (!offer.ok)
        return failure(
          "STALE_OFFER",
          offer.reason === "unavailable"
            ? "That service is no longer available."
            : "The service details changed. Review the current price and duration.",
        );
      const service = offer.service;

      const start = new Date(startInstant.epochMilliseconds);
      const endInstant = startInstant.add({
        minutes: service.durationMinutes,
      });
      const end = new Date(endInstant.epochMilliseconds);

      if (
        service.id === booking.serviceId &&
        parsed.data.barberId === booking.barberId &&
        start.getTime() === booking.startAt.getTime()
      )
        return failure(
          "NO_CHANGE",
          "Choose a different time, service, or barber.",
        );

      const [barber] = await tx
        .select()
        .from(barbers)
        .where(
          and(
            eq(barbers.shopId, shop.id),
            eq(barbers.id, parsed.data.barberId),
            eq(barbers.archived, false),
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

      if (!barber || !assignment)
        return failure(
          "UNAVAILABLE_INTERVAL",
          "That barber is not available for this appointment.",
        );

      const localDate = startInstant
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

      const occupancyId = booking.occupancyId;
      if (!occupancyId)
        return failure(
          "UNAVAILABLE",
          "Appointment reservation is unavailable.",
        );

      const overlap = await findOccupyingInterval(tx, {
        shopId: shop.id,
        barberId: barber.id,
        start,
        end,
        excludeOccupancyId: occupancyId,
      });
      if (overlap)
        return failure(
          "UNAVAILABLE_INTERVAL",
          "That time was just taken. Choose another available time.",
        );

      const occupiedRows = await tx
        .select({
          startAt: occupiedIntervals.startAt,
          endAt: occupiedIntervals.endAt,
        })
        .from(occupiedIntervals)
        .where(
          and(
            eq(occupiedIntervals.shopId, shop.id),
            eq(occupiedIntervals.barberId, barber.id),
            sql`${occupiedIntervals.startAt} < ${end}`,
            sql`${occupiedIntervals.endAt} > ${start}`,
            ne(occupiedIntervals.id, occupancyId),
          ),
        );

      const slots = calculateSlots({
        date: localDate.toString(),
        timeZone: shop.time_zone,
        now: now.toISOString(),
        durationMinutes: service.durationMinutes,
        shopDay: schedule.shopDay,
        barberDay: schedule.barberDay,
        occupied: occupiedRows.map(({ startAt, endAt }) => ({
          start: startAt.toISOString(),
          end: endAt.toISOString(),
        })),
      });

      if (!slots.some((slot) => Date.parse(slot.start) === start.getTime()))
        return failure(
          "UNAVAILABLE_INTERVAL",
          "Choose another available time.",
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
        actorId: null,
        actorType: "customer",
        kind: "move",
        appliedRevision: revision,
        committedAt: now,
        operationKeyHash,
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
      await stageCustomerReminder(tx, {
        bookingId: booking.id,
        revision,
        changeId: eventId,
        contentIdentity: identity,
        startAt: start,
        now,
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
        whatsappOptIn: booking.whatsappOptIn,
        emailConfig,
      });

      return {
        success: true as const,
        data: {
          bookingId: booking.id,
          operation: {
            id: eventId,
            revision,
            committedAt: now.toISOString(),
            snapshot: after,
          },
        },
      };
    });
  } catch {
    return failure(
      "UNAVAILABLE",
      "Appointment is temporarily unavailable. Try again.",
    );
  }
}
