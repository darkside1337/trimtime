import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { bookings } from "@/db/schema/bookings";
import { notificationWork } from "@/db/schema/notification-work";
import { shops } from "@/db/schema/shops";
import type { ActionResult } from "@/lib/action-result";
import { hashSecret } from "./capabilities";
import type { ManagedBookingView, PublicBookingContext } from "./types";
import { customerEmailSummary } from "@/features/notifications/customer-summary";

const unavailable = {
  success: false,
  error: { code: "UNAVAILABLE", message: "This booking link is unavailable." },
} as const;

export async function getManagedBooking(
  context: Pick<PublicBookingContext, "shopId"> | null,
  token: string,
): Promise<ActionResult<ManagedBookingView>> {
  if (!context?.shopId || typeof token !== "string") return unavailable;
  const now = new Date();
  try {
    const [row] = await db
      .select({
        status: bookings.status,
        startAt: bookings.startAt,
        endAt: bookings.endAt,
        serviceName: bookings.serviceName,
        servicePriceUsd: bookings.servicePriceUsd,
        serviceDurationMinutes: bookings.serviceDurationMinutes,
        barberName: bookings.barberName,
        customerName: bookings.customerName,
        customerEmail: bookings.customerEmail,
        customerPhone: bookings.customerPhone,
        whatsappOptIn: bookings.whatsappOptIn,
        capabilityRevokedAt: bookings.capabilityRevokedAt,
        shopName: shops.name,
        publicContact: shops.publicContact,
        address: shops.address,
        timeZone: shops.timeZone,
        emailStatus: notificationWork.status,
        emailReason: notificationWork.reason,
        emailClaimedAt: notificationWork.claimedAt,
        emailUpdatedAt: notificationWork.updatedAt,
      })
      .from(bookings)
      .innerJoin(shops, eq(shops.id, bookings.shopId))
      .leftJoin(
        notificationWork,
        and(
          eq(notificationWork.bookingId, bookings.id),
          eq(notificationWork.kind, "customer_confirmation"),
          eq(notificationWork.channel, "email"),
        ),
      )
      .where(
        and(
          eq(bookings.shopId, context.shopId),
          eq(bookings.capabilityHash, hashSecret(token)),
        ),
      )
      .limit(1);
    if (
      !row ||
      row.capabilityRevokedAt ||
      now.getTime() >= row.endAt.getTime() + 168 * 60 * 60_000
    )
      return unavailable;
    return {
      success: true,
      data: {
        status: row.status as "confirmed" | "cancelled",
        startAt: row.startAt.toISOString(),
        endAt: row.endAt.toISOString(),
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
        notifications: {
          email: customerEmailSummary(
            {
              status: row.emailStatus as
                ManagedBookingView["notifications"]["email"]["status"] | null,
              reason: row.emailReason,
              claimedAt: row.emailClaimedAt,
              updatedAt: row.emailUpdatedAt,
            },
            now,
          ),
        },
        past: row.endAt.getTime() <= now.getTime(),
        changeCutoffPassed:
          row.status !== "confirmed" ||
          row.startAt.getTime() - now.getTime() < 12 * 60 * 60_000,
      },
    };
  } catch {
    return unavailable;
  }
}
