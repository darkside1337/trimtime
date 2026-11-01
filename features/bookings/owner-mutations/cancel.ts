import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema/bookings";
import { resolveEmailConfig } from "@/features/notifications/config";
import { notificationContentIdentity } from "@/features/notifications/content-identity";
import { shops } from "@/db/schema/shops";
import type { ActionResult } from "@/lib/action-result";
import { cancelOwnerBookingSchema } from "../schemas";
import { hashSecret } from "../capabilities";
import {
  stageCustomerChangeNotifications,
  suppressSupersededNotificationWork,
} from "../notification-staging";
import type { OwnerChangeReceipt } from "../types";
import type { OwnerContext } from "@/server/owner-context";
import { getOwnAppointment } from "../queries";
import { bookingChangeEvent } from "./booking-change-event";
import { findOwnerChangeReplay } from "./replay";

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
      const replay = await findOwnerChangeReplay(tx, {
        shopId,
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
