import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema/bookings";
import { bookingChanges } from "@/db/schema/booking-changes";
import { shops } from "@/db/schema/shops";
import type { ActionResult } from "@/lib/action-result";
import { setOwnerAttendanceSchema } from "../schemas";
import { hashSecret } from "../capabilities";
import type { OwnerChangeReceipt } from "../types";
import type { OwnerContext } from "@/server/owner-context";
import { getOwnAppointment } from "../queries";
import { bookingChangeEvent } from "./booking-change-event";
import { findOwnerChangeReplay } from "./replay";

export async function setOwnerAttendance(
  context: OwnerContext | null,
  input: unknown,
): Promise<ActionResult<OwnerChangeReceipt>> {
  const fail = (code: string, message: string) => ({
    success: false as const,
    error: { code, message },
  });
  if (!context?.userId)
    return fail("UNAUTHENTICATED", "Sign in to manage appointments.");
  const parsed = setOwnerAttendanceSchema.safeParse(input);
  if (!parsed.success)
    return fail("VALIDATION_ERROR", "Appointment request is invalid.");
  try {
    const receipt = await db.transaction(async (tx) => {
      const [shop] = await tx
        .select({ id: shops.id })
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
          kind: "attendance",
          bookingId: booking.id,
          expectedRevision: parsed.data.expectedRevision,
          status: parsed.data.status,
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
            "This attendance attempt cannot be recovered.",
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
      if (booking.status === "cancelled")
        return fail(
          "INVALID_STATE",
          "This appointment can no longer be marked.",
        );
      if (booking.endAt.getTime() >= now.getTime())
        return fail(
          "TOO_EARLY",
          "Attendance can only be marked after the appointment ends.",
        );
      if (booking.status === parsed.data.status)
        return fail("NO_CHANGE", "Attendance is already marked as this.");
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
      const after = { ...before, status: parsed.data.status };
      const eventId = randomUUID();
      const revision = booking.revision + 1;
      await tx
        .update(bookings)
        .set({ status: parsed.data.status, revision })
        .where(eq(bookings.id, booking.id));
      await tx.insert(bookingChanges).values({
        id: eventId,
        shopId: shop.id,
        bookingId: booking.id,
        actorId: context.userId,
        kind: "attendance",
        appliedRevision: revision,
        committedAt: now,
        operationKeyHash: keyHash,
        payloadDigest: digest,
        beforeSnapshot: before,
        afterSnapshot: after,
      });
      return {
        success: true as const,
        bookingId: booking.id,
        event: {
          id: eventId,
          kind: "attendance" as const,
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
          kind: "attendance",
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
