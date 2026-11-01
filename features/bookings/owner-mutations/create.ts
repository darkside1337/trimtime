import "server-only";
import { Temporal } from "temporal-polyfill";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { notificationWork } from "@/db/schema/notification-work";
import { resolveEmailConfig } from "@/features/notifications/config";
import { customerEmailSummary } from "@/features/notifications/customer-summary";
import type { ActionResult } from "@/lib/action-result";
import { fitsScheduleInterval } from "@/features/availability/slots";
import { resolveScheduleForDate } from "@/features/availability/schedule-resolution";
import { createOwnerBookingSchema } from "../schemas";
import { hashSecret } from "../capabilities";
import {
  findCreationReplay,
  findOccupyingInterval,
  persistBookingCreation,
  resolveCreationOffer,
} from "../creation-primitives";
import type { ManagedBookingView, OwnerBookingReceipt } from "../types";
import type { OwnerContext } from "@/server/owner-context";
import { getOwnAppointment } from "../queries";

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
