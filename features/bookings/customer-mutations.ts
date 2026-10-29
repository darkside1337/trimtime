import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema/bookings";
import { bookingChanges } from "@/db/schema/booking-changes";
import { resolveEmailConfig } from "@/features/notifications/config";
import { notificationContentIdentity } from "@/features/notifications/content-identity";
import type { ActionResult } from "@/lib/action-result";
import { hashSecret } from "./capabilities";
import {
  stageCustomerChangeNotifications,
  suppressSupersededNotificationWork,
} from "./notification-staging";
import { recordRateEvent } from "./public-mutations";
import { cancelCustomerBookingSchema } from "./schemas";
import type {
  CustomerCancellationReceipt,
  PublicBookingContext,
} from "./types";

function failure(code: string, message: string) {
  return { success: false as const, error: { code, message } };
}

export async function cancelCustomerBooking(
  context: PublicBookingContext | null,
  input: unknown,
): Promise<ActionResult<CustomerCancellationReceipt>> {
  if (!context?.shopId)
    return failure("UNAVAILABLE", "This booking link is unavailable.");
  const parsed = cancelCustomerBookingSchema.safeParse(input);
  if (!parsed.success)
    return failure("VALIDATION_ERROR", "Appointment request is invalid.");
  try {
    return await db.transaction(async (tx) => {
      const locked = await tx.execute(
        sql`SELECT s.id, u.email AS owner_email FROM shops s JOIN "user" u ON u.id=s.owner_id WHERE s.id=${context.shopId} FOR UPDATE OF s`,
      );
      const shop = locked.rows[0] as
        { id: string; owner_email: string } | undefined;
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
        booking.capabilityRevokedAt ||
        now.getTime() >= booking.endAt.getTime() + 168 * 60 * 60_000
      )
        return failure("UNAVAILABLE", "This booking link is unavailable.");
      const operationKeyHash = hashSecret(parsed.data.operationKey);
      const digest = hashSecret(
        JSON.stringify({
          kind: "cancel",
          actorType: "customer",
          shopId: shop.id,
          bookingId: booking.id,
          capabilityHash,
          expectedRevision: parsed.data.expectedRevision,
          confirmed: parsed.data.confirmed,
        }),
      );
      const [replay] = await tx
        .select({
          id: bookingChanges.id,
          bookingId: bookingChanges.bookingId,
          actorType: bookingChanges.actorType,
          kind: bookingChanges.kind,
          appliedRevision: bookingChanges.appliedRevision,
          committedAt: bookingChanges.committedAt,
          payloadDigest: bookingChanges.payloadDigest,
        })
        .from(bookingChanges)
        .where(
          and(
            eq(bookingChanges.shopId, shop.id),
            eq(bookingChanges.operationKeyHash, operationKeyHash),
          ),
        )
        .limit(1);
      if (
        replay &&
        replay.bookingId === booking.id &&
        replay.actorType === "customer" &&
        replay.kind === "cancel" &&
        replay.payloadDigest === digest
      )
        return {
          success: true as const,
          data: {
            bookingId: replay.bookingId,
            operation: {
              id: replay.id,
              revision: replay.appliedRevision,
              committedAt: replay.committedAt.toISOString(),
            },
            status: "cancelled" as const,
          },
        };
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
          "Too many cancellation attempts. Please wait before trying again.",
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
          "This appointment can no longer be cancelled.",
        );
      if (booking.startAt.getTime() - now.getTime() < 12 * 60 * 60_000)
        return failure(
          "CUTOFF_PASSED",
          "This appointment is inside the change window. Contact the shop.",
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
      const revision = booking.revision + 1;
      const eventId = randomUUID();
      if (booking.occupancyId)
        await tx.execute(
          sql`DELETE FROM occupied_intervals WHERE id=${booking.occupancyId}`,
        );
      await tx.execute(
        sql`UPDATE bookings SET status='cancelled', occupancy_id=NULL, revision=${revision} WHERE id=${booking.id}`,
      );
      await tx.insert(bookingChanges).values({
        id: eventId,
        shopId: shop.id,
        bookingId: booking.id,
        actorId: null,
        actorType: "customer",
        kind: "cancel",
        appliedRevision: revision,
        committedAt: now,
        operationKeyHash,
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
      const emailConfig = resolveEmailConfig(process.env);
      await suppressSupersededNotificationWork(tx, booking.id, revision, now);
      await stageCustomerChangeNotifications(tx, {
        bookingId: booking.id,
        revision,
        changeId: eventId,
        kind: "customer_cancellation",
        contentIdentity: identity,
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
        whatsappOptIn: booking.whatsappOptIn,
        emailConfig,
        ownerEmail: shop.owner_email,
      });
      return {
        success: true as const,
        data: {
          bookingId: booking.id,
          operation: {
            id: eventId,
            revision,
            committedAt: now.toISOString(),
          },
          status: "cancelled" as const,
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
